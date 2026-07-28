/**
 * Ingestion service: reads a regulator's normalized scraper output (the
 * NormalizedDocument JSON produced by a Python adapter — see
 * scrapers/normalized_document.py), gets full text, classifies each
 * document against that regulator's REAL taxonomy in Postgres via
 * DeepSeek, and writes SourceDocument + UpdateEntry rows.
 *
 * Classification prompt/rules are ported from deepseek_eval.py
 * (C:\Users\shoot\Projects\ANS Wiki System\deepseek_eval.py), generalized
 * so the tag lists come from Postgres per-regulator instead of IFSCA's
 * hardcoded SUBJECT_CODES/INSTRUMENT_CODES dicts. Two IFSCA-specific rules
 * were intentionally NOT ported because they name IFSCA's own tags
 * literally ("Governance and Rulemaking > Development and Policy",
 * "Procedure for Making Regulations") — those aren't generalizable
 * instructions, they're taxonomy-specific carve-outs. The remaining rules
 * (single-tag Subject + parent-fallback, entity-vs-activity tie-break,
 * self-referential-only Amended/Superseded, default-to-In-Force) are
 * regulator-agnostic and kept verbatim.
 *
 * Status is NOT fetched from Postgres — DocumentStatus is a fixed,
 * regulator-agnostic enum on the schema (see schema.prisma's own "OPEN
 * QUESTION #4" note), so its 4 values are hardcoded here to match that
 * enum, the same way deepseek_eval.py hardcoded STATUS_VALUES.
 */

import { Facet, TagStatus, DocumentStatus, SourceNature } from "@/app/generated/prisma/enums";
import type { TaxonomyTagModel as TaxonomyTag } from "@/app/generated/prisma/models/TaxonomyTag";
import { prisma } from "./prisma";
import OpenAI from "openai";
import { PDFParse } from "pdf-parse";

// ---------------------------------------------------------------------------
// Input shape — mirrors scrapers/normalized_document.py's NormalizedDocument
// dataclass field-for-field. Python is the producer, this is the consumer.
// ---------------------------------------------------------------------------
export interface NormalizedDocument {
  regulator_code: string;
  source_id: string;
  title: string;
  source_url: string;
  published_date: string | null;
  file_url: string | null;
  file_extension_hint: string | null;
  category_hint: string | null;
  raw_text: string | null;
  raw_text_source: "html_page" | "pdf_full" | "pdf_excerpt" | null;
  needs_download: boolean;
  scraped_at: string | null;
}

export type IngestOutcome =
  | { status: "skipped_duplicate"; sourceId: string; title: string }
  | {
      status: "ingested";
      sourceId: string;
      title: string;
      documentCode: string;
      subject: string;
      instrumentType: string;
      statusValue: string;
      confidence: number;
      needsReview: boolean;
      reviewReasons: string[];
    }
  | { status: "error"; sourceId: string; title: string; error: string };

// ---------------------------------------------------------------------------
// DeepSeek client — OpenAI-compatible API, same as deepseek_eval.py's setup.
// ---------------------------------------------------------------------------
const DEEPSEEK_BASE_URL = "https://api.deepseek.com";
const MODEL = "deepseek-chat";
const AUTO_ACCEPT_THRESHOLD = 0.75; // matches PIPELINE_OVERVIEW.md §3.1's calibrated threshold

function getDeepSeekClient(): OpenAI {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error(
      "DEEPSEEK_API_KEY is not set. Add it to .env before running the ingestion service."
    );
  }
  return new OpenAI({ apiKey, baseURL: DEEPSEEK_BASE_URL });
}

const STATUS_VALUES = ["In Force", "Draft/Consultation", "Amended", "Superseded/Repealed"] as const;
type StatusLabel = (typeof STATUS_VALUES)[number];

const STATUS_LABEL_TO_ENUM: Record<StatusLabel, DocumentStatus> = {
  "In Force": DocumentStatus.IN_FORCE,
  "Draft/Consultation": DocumentStatus.DRAFT_CONSULTATION,
  Amended: DocumentStatus.AMENDED,
  "Superseded/Repealed": DocumentStatus.SUPERSEDED_REPEALED,
};

interface ClassificationResult {
  subject: string;
  instrument_type: string;
  status: string;
  confidence: number;
  reason: string;
}

/**
 * Ported from deepseek_eval.py's build_prompt(). Generalized: subject_list
 * and instrument_list are passed in from Postgres per-regulator, rather
 * than being IFSCA's hardcoded SUBJECT_CODES/INSTRUMENT_CODES. The two
 * IFSCA-named-tag carve-outs from the original are deliberately dropped
 * (see module docstring) — everything else is verbatim.
 */
function buildPrompt(
  regulatorName: string,
  title: string,
  body: string | null,
  subjectList: string[],
  instrumentList: string[]
): string {
  return `You are classifying a regulatory document from ${regulatorName} along three facets. For Subject and Instrument Type, you MUST choose only from the exact lists given below — do not invent a new value or paraphrase an existing one.

SUBJECT (choose exactly one from this list):
${JSON.stringify(subjectList, null, 2)}

INSTRUMENT TYPE (choose exactly one from this list):
${JSON.stringify(instrumentList, null, 2)}

STATUS (choose exactly one):
${JSON.stringify(STATUS_VALUES)}

TAGGING RULES YOU MUST FOLLOW:

Subject rules:
- Subject is single-tag. If a document spans a sub-hierarchy (e.g. both a "Parent" tag's two children), use the shared parent tag instead of picking one child — but ONLY when the document genuinely doesn't specify which child. If the document clearly names a specific entity type belonging to one child, use that specific child tag, not the parent.
- When two tags both seem to fit, the tag defining what KIND OF ENTITY the document is about wins over a tag describing an activity or topic the entity is involved in.
- Always prioritize what the document's own text explicitly says over pattern-matching from the title or from what similar-sounding documents are usually tagged.

Status rules:
- DEFAULT to "In Force" unless there is a clear, specific reason otherwise. A final report, a notified rule, an order, or a notice being ABOUT a consultation are all normally "In Force" as documents in their own right, even if their SUBJECT MATTER is advisory, non-binding, or consultation-related. Do not tag something "Draft/Consultation" just because it discusses or relates to a consultation process — only the actual consultation/draft document itself (or a notice extending its comment deadline) is "Draft/Consultation".
- "Amended" or "Superseded/Repealed" apply ONLY when the document ITSELF has been changed or replaced by something else (self-referential, e.g. "(as amended)", "has been superseded"). A document that itself amends or supersedes ANOTHER document keeps its own status as "In Force" (or "Draft/Consultation" if it is itself a draft/consultation document) — do not confuse "this document changes something else" with "this document has been changed."

Document title: ${title}

Document text:
${body ? body.slice(0, 4000) : "(no body text provided — classify from title alone)"}

Respond with ONLY a JSON object, no other text, in this exact shape:
{"subject": "<exact tag from the Subject list>", "instrument_type": "<exact tag from the Instrument Type list>", "status": "<exact value from the Status list>", "confidence": <float 0-1>, "reason": "<one sentence>"}
`;
}

async function classifyDocument(
  regulatorName: string,
  title: string,
  body: string | null,
  subjectTags: TaxonomyTag[],
  instrumentTags: TaxonomyTag[]
): Promise<ClassificationResult> {
  const client = getDeepSeekClient();
  const subjectList = subjectTags.map((t) => t.name).sort();
  const instrumentList = instrumentTags.map((t) => t.name).sort();

  const prompt = buildPrompt(regulatorName, title, body, subjectList, instrumentList);

  const response = await client.chat.completions.create({
    model: MODEL,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" },
    temperature: 0,
  });

  const raw = response.choices[0]?.message?.content;
  if (!raw) {
    throw new Error("DeepSeek returned an empty response");
  }

  const parsed = JSON.parse(raw) as ClassificationResult;
  return parsed;
}

// ---------------------------------------------------------------------------
// Step 1: dedup check
// ---------------------------------------------------------------------------
async function findExistingSourceDocument(regulatorId: string, sourceId: string) {
  return prisma.sourceDocument.findUnique({
    where: { regulatorId_sourceId: { regulatorId, sourceId } },
  });
}

// ---------------------------------------------------------------------------
// Step 2: get full text
// ---------------------------------------------------------------------------
interface FullTextResult {
  text: string | null;
  source: NormalizedDocument["raw_text_source"];
  extractionFailed: boolean;
}

export async function getFullText(doc: NormalizedDocument): Promise<FullTextResult> {
  if (doc.raw_text) {
    return { text: doc.raw_text, source: doc.raw_text_source, extractionFailed: false };
  }

  if (doc.needs_download && doc.file_url) {
    // DoT's PDFs are direct links (no JS-rendered viewer) — a straightforward
    // fetch + pdf-parse is sufficient here. Not adding IFSCA's two-column
    // extraction logic unless real DoT PDFs are actually observed to need it.
    try {
      const res = await fetch(doc.file_url);
      if (!res.ok) {
        return { text: null, source: null, extractionFailed: true };
      }
      const buffer = Buffer.from(await res.arrayBuffer());
      const parser = new PDFParse({ data: buffer });
      const parsed = await parser.getText();
      const text = (parsed.text || "").trim();
      if (!text) {
        return { text: null, source: null, extractionFailed: true };
      }
      return { text, source: "pdf_full", extractionFailed: false };
    } catch {
      return { text: null, source: null, extractionFailed: true };
    }
  }

  return { text: null, source: null, extractionFailed: false };
}

// ---------------------------------------------------------------------------
// Step 3: fetch the regulator's ACTUAL current taxonomy from Postgres
// ---------------------------------------------------------------------------
async function fetchActiveTaxonomy(regulatorId: string) {
  const tags = await prisma.taxonomyTag.findMany({
    where: {
      regulatorId,
      status: TagStatus.ACTIVE, // excludes UNDER_REVIEW placeholder tags
      facet: { in: [Facet.SUBJECT, Facet.INSTRUMENT_TYPE] },
    },
  });

  return {
    subjectTags: tags.filter((t) => t.facet === Facet.SUBJECT),
    instrumentTags: tags.filter((t) => t.facet === Facet.INSTRUMENT_TYPE),
  };
}

// ---------------------------------------------------------------------------
// Step 4: document code generation — {REGULATOR}-{SUBJECT}-{INSTRUMENT}-{YEAR}-{SEQ}
// Sequence is derived from Postgres itself (max existing sequence for this
// prefix + 1) rather than a separate JSON tracker file like IFSCA's
// ifsca_sequence_tracker.json — Postgres is already the persisted, durable
// store here, so a second tracker file would just be a second source of
// truth to keep in sync.
// ---------------------------------------------------------------------------
async function nextDocumentCode(
  regulatorCode: string,
  subjectShortCode: string,
  instrumentShortCode: string,
  year: number
): Promise<string> {
  const prefix = `${regulatorCode}-${subjectShortCode}-${instrumentShortCode}-${year}`;
  const existing = await prisma.updateEntry.findMany({
    where: { documentCode: { startsWith: `${prefix}-` } },
    select: { documentCode: true },
  });

  let max = 0;
  for (const { documentCode } of existing) {
    const seqStr = documentCode.split("-").pop();
    const seq = seqStr ? parseInt(seqStr, 10) : NaN;
    if (!Number.isNaN(seq) && seq > max) max = seq;
  }

  const next = max + 1;
  return `${prefix}-${String(next).padStart(3, "0")}`;
}

// ---------------------------------------------------------------------------
// Orchestration
// ---------------------------------------------------------------------------
export async function ingestDocument(
  doc: NormalizedDocument,
  regulator: { id: string; code: string; name: string },
  taxonomy: { subjectTags: TaxonomyTag[]; instrumentTags: TaxonomyTag[] }
): Promise<IngestOutcome> {
  // Step 1: dedup
  const existing = await findExistingSourceDocument(regulator.id, doc.source_id);
  if (existing) {
    return { status: "skipped_duplicate", sourceId: doc.source_id, title: doc.title };
  }

  try {
    // Step 2: full text
    const { text, source: textSource, extractionFailed } = await getFullText(doc);

    // Step 3: classify
    const classification = await classifyDocument(
      regulator.name,
      doc.title,
      text,
      taxonomy.subjectTags,
      taxonomy.instrumentTags
    );

    const subjectTag = taxonomy.subjectTags.find((t) => t.name === classification.subject);
    const instrumentTag = taxonomy.instrumentTags.find(
      (t) => t.name === classification.instrument_type
    );
    const statusValue =
      STATUS_LABEL_TO_ENUM[classification.status as StatusLabel] ?? DocumentStatus.IN_FORCE;

    const reviewReasons: string[] = [];
    if (classification.confidence < AUTO_ACCEPT_THRESHOLD) reviewReasons.push("low_confidence");
    if (!subjectTag) reviewReasons.push("model_returned_invalid_subject_tag");
    if (!instrumentTag) reviewReasons.push("model_returned_invalid_instrument_tag");
    if (extractionFailed) reviewReasons.push("text_extraction_failed");

    const needsReview = reviewReasons.length > 0;

    const publishedDate = doc.published_date ? new Date(doc.published_date) : null;
    const year = publishedDate?.getFullYear() ?? new Date().getFullYear();

    const documentCode = await nextDocumentCode(
      regulator.code,
      subjectTag?.shortCode ?? "UNK",
      instrumentTag?.shortCode ?? "UNK",
      year
    );

    // Step 4: write to Postgres
    const sourceDocument = await prisma.sourceDocument.create({
      data: {
        regulatorId: regulator.id,
        sourceId: doc.source_id,
        title: doc.title,
        sourceUrl: doc.source_url,
        fileUrl: doc.file_url,
        publishedDate,
        isDigest: false,
      },
    });

    await prisma.updateEntry.create({
      data: {
        documentCode,
        sourceDocumentId: sourceDocument.id,
        sourceNature: SourceNature.PRIMARY,
        title: doc.title,
        subjectId: subjectTag?.id,
        instrumentTypeId: instrumentTag?.id,
        status: statusValue,
        subjectConfidence: classification.confidence,
        instrumentConfidence: classification.confidence,
        statusConfidence: classification.confidence,
        classificationReason: classification.reason,
        needsReview,
        reviewReasons,
        taxonomyVersion: "v1.0",
        classifiedBy: MODEL,
      },
    });

    // Step 5: log
    const flag = needsReview ? "FLAGGED" : "auto-accepted";
    console.log(
      `[${flag}] ${doc.title.slice(0, 70)} -> subject=${classification.subject} | instrument=${classification.instrument_type} | confidence=${classification.confidence.toFixed(2)}`
    );

    return {
      status: "ingested",
      sourceId: doc.source_id,
      title: doc.title,
      documentCode,
      subject: classification.subject,
      instrumentType: classification.instrument_type,
      statusValue,
      confidence: classification.confidence,
      needsReview,
      reviewReasons,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.log(`[ERROR] ${doc.title.slice(0, 70)} -> ${message}`);
    return { status: "error", sourceId: doc.source_id, title: doc.title, error: message };
  }
}

export async function ingestBatch(
  docs: NormalizedDocument[],
  regulatorCode: string
): Promise<IngestOutcome[]> {
  const regulator = await prisma.regulator.findUnique({ where: { code: regulatorCode } });
  if (!regulator) {
    throw new Error(`Regulator with code "${regulatorCode}" not found in Postgres.`);
  }

  const taxonomy = await fetchActiveTaxonomy(regulator.id);
  if (taxonomy.subjectTags.length === 0 || taxonomy.instrumentTags.length === 0) {
    throw new Error(
      `Regulator "${regulatorCode}" has no ACTIVE Subject/Instrument Type tags — seed its taxonomy first.`
    );
  }

  const results: IngestOutcome[] = [];
  for (const doc of docs) {
    const result = await ingestDocument(doc, regulator, taxonomy);
    results.push(result);
  }
  return results;
}
