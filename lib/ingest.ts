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
  status_hint: string | null;
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

// doc.status_hint carries a REAL status label from the source site itself
// (currently only MTCTE's archive Active/Expired column) — ground truth,
// not a model guess, so it overrides the classifier's own status
// determination when present. Decision confirmed via a real spot-check
// (2026-07-28) of MTCTE's actual Expired documents: both Expired PDFs with
// an extractable text layer ("MTCTE Procedure ver 2.0" and "MTCTE Applicant
// User Instructions") turned out to be explicitly version-numbered manuals
// later replaced by a newer numbered version confirmed elsewhere in the same
// archive (v2.1/v3.0 and V3.0 respectively) — i.e. real supersession, not
// just a calendar-bound lapse with no replacement — so SUPERSEDED_REPEALED
// is the correct mapping, not a vaguer "expired" reading.
const STATUS_HINT_TO_ENUM: Record<string, DocumentStatus> = {
  Active: DocumentStatus.IN_FORCE,
  Expired: DocumentStatus.SUPERSEDED_REPEALED,
};

// Resolves the final DocumentStatus for a document: the source site's own
// status_hint wins when present and recognized (MTCTE today); otherwise
// falls back to the classifier's own status label, then IN_FORCE if that
// label is missing/invalid — exactly the prior behavior, so DoT and every
// other regulator without a status_hint signal are completely unaffected.
export function resolveStatusValue(
  classificationStatus: string,
  statusHint: string | null
): DocumentStatus {
  if (statusHint && STATUS_HINT_TO_ENUM[statusHint]) {
    return STATUS_HINT_TO_ENUM[statusHint];
  }
  return STATUS_LABEL_TO_ENUM[classificationStatus as StatusLabel] ?? DocumentStatus.IN_FORCE;
}

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
// Retry wrapper for transient Neon connection failures.
//
// Confirmed via two real runs (2026-07-28) against this long-running batch
// (many sequential documents, each with a slow PDF download + DeepSeek call
// in between Postgres queries): Neon's serverless compute auto-suspends
// after a period of inactivity, and the pooled connection can be dropped/
// refused during its cold-start wake-up. The first run lost 1 document to
// an uncaught version of this; after moving the dedup check inside the
// try/catch, a full re-run instead saw 553 of 581 documents fail with the
// SAME "Can't reach database server" error — the idle gaps between this
// workload's Postgres calls are apparently long/frequent enough to
// reliably trigger it, not a rare edge case. A plain connectivity check
// immediately afterward succeeded in ~4 seconds — consistent with a cold
// start, not a real outage. Retrying with backoff, rather than failing
// immediately, is the fix; every Postgres call in the per-document hot
// path uses this.
async function withRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
  const DELAYS_MS = [2000, 5000, 10000];
  for (let attempt = 0; attempt <= DELAYS_MS.length; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const isConnectionError =
        err instanceof Error &&
        (("code" in err && (err as { code?: string }).code === "P1001") ||
          err.message.includes("Can't reach database server") ||
          // confirmed via a real run (2026-07-28): 2/581 documents hit this
          // exact wording — a different connection-drop message than P1001,
          // from the underlying pg driver rather than Prisma's own wrapper
          err.message.includes("Connection terminated unexpectedly"));
      if (!isConnectionError || attempt === DELAYS_MS.length) {
        throw err;
      }
      const delay = DELAYS_MS[attempt];
      console.log(`  [retry] ${label} hit a connection error, retrying in ${delay}ms (attempt ${attempt + 1}/${DELAYS_MS.length})`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
  throw new Error("unreachable");
}

// ---------------------------------------------------------------------------
// Step 1: dedup check
// ---------------------------------------------------------------------------
async function findExistingSourceDocument(regulatorId: string, sourceId: string) {
  return withRetry(
    () =>
      prisma.sourceDocument.findUnique({
        where: { regulatorId_sourceId: { regulatorId, sourceId } },
      }),
    "dedup check"
  );
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
  const tags = await withRetry(
    () =>
      prisma.taxonomyTag.findMany({
        where: {
          regulatorId,
          status: TagStatus.ACTIVE, // excludes UNDER_REVIEW placeholder tags
          facet: { in: [Facet.SUBJECT, Facet.INSTRUMENT_TYPE] },
        },
      }),
    "fetchActiveTaxonomy"
  );

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
  const existing = await withRetry(
    () =>
      prisma.updateEntry.findMany({
        where: { documentCode: { startsWith: `${prefix}-` } },
        select: { documentCode: true },
      }),
    "documentCode sequence lookup"
  );

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
  try {
    // Step 1: dedup
    // Deliberately INSIDE the try block — a transient Neon connection
    // blip here previously crashed an entire 581-document batch run
    // uncaught (confirmed 2026-07-28), the same "one flaky operation
    // kills the whole run" class of bug already fixed multiple times in
    // dot_watcher.py's Python side, just not yet applied here.
    const existing = await findExistingSourceDocument(regulator.id, doc.source_id);
    if (existing) {
      return { status: "skipped_duplicate", sourceId: doc.source_id, title: doc.title };
    }

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
    const statusValue = resolveStatusValue(classification.status, doc.status_hint);

    // Confirmed via a real run (2026-07-28): 228 of 581 documents carried
    // a published_date the adapter couldn't parse (fixed at the source in
    // dot_adapter.py/dot_watcher.py — see their own comments), which made
    // `new Date(...)` return an Invalid Date and crashed the Postgres
    // write outright. Even with that upstream fix, this ingestion service
    // consumes adapter output it doesn't fully control — degrading
    // gracefully here (null + a review flag) rather than trusting every
    // adapter to always produce a parseable date is the same discipline
    // applied to every other adapter-data-quality issue in this pipeline
    // (text extraction failures, invalid model tags, etc.).
    const parsedDate = doc.published_date ? new Date(doc.published_date) : null;
    const publishedDate = parsedDate && !isNaN(parsedDate.getTime()) ? parsedDate : null;
    const unparseableDate = Boolean(doc.published_date) && publishedDate === null;

    const reviewReasons: string[] = [];
    if (classification.confidence < AUTO_ACCEPT_THRESHOLD) reviewReasons.push("low_confidence");
    if (!subjectTag) reviewReasons.push("model_returned_invalid_subject_tag");
    if (!instrumentTag) reviewReasons.push("model_returned_invalid_instrument_tag");
    if (extractionFailed) reviewReasons.push("text_extraction_failed");
    if (unparseableDate) reviewReasons.push("unparseable_published_date");

    const needsReview = reviewReasons.length > 0;

    const year = publishedDate?.getFullYear() ?? new Date().getFullYear();

    const documentCode = await nextDocumentCode(
      regulator.code,
      subjectTag?.shortCode ?? "UNK",
      instrumentTag?.shortCode ?? "UNK",
      year
    );

    // Step 4: write to Postgres
    // Note: if a create's response is lost to a connection drop after it
    // actually succeeded server-side, the retry will hit a unique-
    // constraint error (not a connection error, so withRetry won't retry
    // it further) and this document will be logged as errored even
    // though it's really already written — self-corrects on the next
    // run, since the dedup check will then find it. Accepted tradeoff:
    // far better than the alternative of not retrying connection drops
    // at all (553/581 failed that way).
    const sourceDocument = await withRetry(
      () =>
        prisma.sourceDocument.create({
          data: {
            regulatorId: regulator.id,
            sourceId: doc.source_id,
            title: doc.title,
            sourceUrl: doc.source_url,
            fileUrl: doc.file_url,
            publishedDate,
            isDigest: false,
          },
        }),
      "SourceDocument create"
    );

    await withRetry(
      () =>
        prisma.updateEntry.create({
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
        }),
      "UpdateEntry create"
    );

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
    // A previous run (2026-07-28) logged 228 of these with an EMPTY
    // message (`.message` was "" despite `err instanceof Error` being
    // true) — not enough to diagnose the real cause. Capturing name +
    // stack + a full own-properties JSON dump so the next occurrence is
    // actually diagnosable instead of another blank line.
    let message: string;
    if (err instanceof Error) {
      message = err.message || `(empty message) name=${err.name} stack=${err.stack?.split("\n")[0]}`;
    } else {
      message = String(err);
    }
    console.log(`[ERROR] ${doc.title.slice(0, 70)} -> ${message}`);
    if (err instanceof Error && !err.message) {
      try {
        console.log(`  full error detail: ${JSON.stringify(err, Object.getOwnPropertyNames(err))}`);
      } catch {
        console.log(`  (error object not JSON-serializable)`);
      }
    }
    return { status: "error", sourceId: doc.source_id, title: doc.title, error: message };
  }
}

export async function ingestBatch(
  docs: NormalizedDocument[],
  regulatorCode: string
): Promise<IngestOutcome[]> {
  const regulator = await withRetry(
    () => prisma.regulator.findUnique({ where: { code: regulatorCode } }),
    "fetch regulator"
  );
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
