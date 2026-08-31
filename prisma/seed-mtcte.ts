/**
 * Seed script: MTCTE (Mandatory Testing and Certification of Telecom
 * Equipment) taxonomy.
 *
 * Same pattern as seed-dot.ts — idempotent via upsert, safe to re-run.
 * MTCTE sits under the same "Telecom" Domain as DoT, but its Subject and
 * Instrument Type vocabularies are entirely its own (per-Regulator
 * scoping, confirmed correct by real evidence: zero taxonomy overlap
 * between DoT's licensing/spectrum content and MTCTE's equipment
 * certification content, despite sharing a Domain).
 *
 * Built from a real, fully deduplicated 151-document pressure-test batch
 * (date-aware cross-source dedup — see scrapers/mtcte_adapter.py comments
 * for why title-only fuzzy matching was insufficient here).
 *
 * Run with: npx tsx prisma/seed-mtcte.ts
 */

import "dotenv/config"; // required when run standalone via tsx — see seed-dot.ts's note
import { prisma } from "../lib/prisma";
import { seedStandardStatusTags } from "./seed-shared";

const SUBJECT_TAGS: Array<{
  name: string;
  shortCode: string;
  definition: string;
  status: "ACTIVE" | "UNDER_REVIEW" | "DEPRECATED";
  notes?: string;
}> = [
  {
    name: "Exemptions",
    shortCode: "EXEMPT",
    definition:
      "Product- or parameter-level exemptions, relaxations, and non-applicability determinations from MTCTE testing/certification requirements.",
    status: "ACTIVE",
    notes:
      "CONFIRMED dominant category — ~50 of 151 real pressure-tested titles. Includes a 15-filing periodic-reissue family ('Exemption pertaining to various parameters/Interfaces of ERs under MTCTE', refiled every 2-3 months since 2022) — each filing is a distinct real document, not a duplicate; date-aware dedup was required to avoid collapsing them (see mtcte_adapter.py).",
  },
  {
    name: "Essential Requirements & Product Categories",
    shortCode: "ER",
    definition:
      "Essential Requirements (ER) definitions/annexures, phase launches, product coverage notifications, and de-notifications.",
    status: "ACTIVE",
    notes: "CONFIRMED — ~25 real titles.",
  },
  {
    name: "Conformity Assessment Bodies & Test Labs",
    shortCode: "CAB",
    definition: "CAB/lab designation, ILAC/NABL/BIS test report acceptance, testing charges and capability disclosures.",
    status: "ACTIVE",
    notes: "CONFIRMED — ~20 real titles.",
  },
  {
    name: "Testing & Certification Procedure",
    shortCode: "PROC",
    definition: "The MTCTE Procedure document itself (versions/amendments), user instructions, certification criteria.",
    status: "ACTIVE",
    notes:
      "CONFIRMED — ~15 real titles. RULE: procedure amendments are tagged here even when their content topically relates to another Subject (e.g. a labelling-guideline revision delivered via a Procedure amendment stays here, not under Certificate Terms & Conditions).",
  },
  {
    name: "Security Certification",
    shortCode: "SEC",
    definition: "Security certification requirements for network-connected equipment (ONT/OLT under ComSec, WiFi CPE/IP Router security testing, 5G Core Nodes).",
    status: "ACTIVE",
    notes:
      "CONFIRMED — ~10 real titles, genuinely distinct from general Essential Requirements. RULE: an explicit security-testing/certification callout in a title wins over a generic product/phase notification tag.",
  },
  {
    name: "Governance and Rulemaking",
    shortCode: "GOV",
    definition: "Scheme/fee administration, meeting logistics, product-lifecycle (EoL/EoS) clarifications, and DoT-level legislative Rules referenced on MTCTE's own site.",
    status: "ACTIVE",
    notes: "CONFIRMED — ~10 real titles. Includes two Rules-level documents (Telecommunications Standards/Conformity Assessment Rules, 2025) — kept here since they appear on MTCTE's own site listing.",
  },
  {
    name: "Certificate Terms & Conditions",
    shortCode: "CERT",
    definition: "Certificate validity periods, terms and conditions, associated-model additions to an existing certificate.",
    status: "ACTIVE",
    notes: "CONFIRMED — ~4 real titles.",
  },
  {
    name: "Appeals",
    shortCode: "APP",
    definition: "Appeal handling procedures under the MTCTE regime.",
    status: "ACTIVE",
    notes: "CONFIRMED — 3 real titles. Small but genuinely distinct; kept separate from the Governance catch-all, matching the IFSCA Arbitration precedent (dispute-resolution functions stay their own category even at low volume).",
  },
  {
    name: "Voluntary Certification Scheme",
    shortCode: "VOL",
    definition: "TEC's voluntary (non-mandatory) certification scheme — distinct from MTCTE's mandatory regime.",
    status: "DEPRECATED",
    notes:
      "RETIRED (2026-07-30) — checked against all 151 real ingested MTCTE documents (archive_circulars_instructions, archive_proforma_formats, whats_new_marquee, policy_vision_head), not just the original single external link. Exactly one substantive real match found: 'Voluntary Security Certification for IP Router and WiFi CPE' (real PDF, archive_circulars_instructions, Active), already auto-classified under Security Certification at 0.95 confidence, unflagged — the pipeline itself resolved it correctly without this tag existing. The only other candidate ('Click here for Voluntary Certification procedure...') is the same thin external tec.gov.in homepage pointer already known, no real content of its own. 0 UpdateEntry rows were ever tagged with this Subject (UNDER_REVIEW tags are excluded from the classifier's options, so this was never reachable regardless). Decision: fold into Security Certification rather than keep an indefinite placeholder open — do not re-investigate this without new evidence beyond what's already been checked here.",
  },
];

// Revised 2026-07-28: rebuilt directly against the real 151-title dataset,
// not against either prior draft. Notably, Exemptions does NOT get its own
// Instrument Type here (both prior drafts leaned that way) — Subject and
// Instrument Type are meant to be orthogonal (Subject = what it's about,
// Instrument Type = what kind of document it is), and Exemptions already
// exists as the dominant Subject tag above. A parallel "Exemption/
// Relaxation Order" Instrument Type would just restate the Subject under a
// different facet rather than add new information — unlike e.g. IFSCA's
// "Master Circular", which earned its own Instrument Type for a reason
// genuinely independent of subject matter (document formality/weight). By
// real title convention (the "-reg" suffix, "Addendum-"/"Corrigendum-"
// prefixes), MTCTE's exemption filings read as the same formal Notification
// register as everything else there, so they fold into Notification and
// Exemptions alone carries the substantive distinction.
const INSTRUMENT_TYPE_TAGS: Array<{ name: string; shortCode: string; definition: string }> = [
  {
    name: "Notification",
    shortCode: "NOT",
    definition: "A formal MTCTE notification — phase launches, product coverage, and (deliberately) the exemption/relaxation filing family, per this file's own note above.",
  },
  {
    name: "Circular/Letter",
    shortCode: "CIR",
    definition: "An administrative communication not rising to the formal Notification register.",
  },
  {
    name: "Clarification",
    shortCode: "CLR",
    definition: "A clarification issued in response to a specific query or ambiguity.",
  },
  {
    name: "Procedure Document",
    shortCode: "PROC",
    definition: "The MTCTE Procedure document itself, or a versioned amendment to it.",
  },
  {
    name: "User Instructions",
    shortCode: "UI",
    definition: "User/applicant/CAB testing officer instruction manuals for the MTCTE portal or process.",
  },
  {
    name: "FAQ",
    shortCode: "FAQ",
    definition: "A frequently-asked-questions document.",
  },
  {
    name: "Consultation",
    shortCode: "CONS",
    definition: "A public consultation seeking input/suggestions (e.g. on a Procedure revision).",
  },
  {
    name: "Rules",
    shortCode: "RUL",
    definition: "Legislative Rules (Act-derived), as distinct from MTCTE's own internal Procedure document.",
  },
  {
    name: "Proforma/Form",
    shortCode: "FORM",
    definition: "A blank application/exemption-request form.",
  },
  {
    name: "Reference Document",
    shortCode: "REF",
    definition: "Non-substantive reference assets (e.g. logo files, BOM format templates) — not regulatory content.",
  },
];

async function main() {
  console.log("Seeding MTCTE taxonomy...");

  const domain = await prisma.domain.upsert({
    where: { name: "Telecom" },
    update: {},
    create: { name: "Telecom", description: "Telecommunications sector regulators." },
  });
  console.log(`Domain "Telecom" ready (id: ${domain.id})`);

  const regulator = await prisma.regulator.upsert({
    where: { code: "MTCTE" },
    update: { domainId: domain.id },
    create: {
      code: "MTCTE",
      name: "Mandatory Testing and Certification of Telecom Equipment (TEC)",
      domainId: domain.id,
      websiteUrl: "https://www.mtcte.tec.gov.in",
    },
  });
  console.log(`Regulator "MTCTE" ready (id: ${regulator.id})`);

  for (const tag of SUBJECT_TAGS) {
    await prisma.taxonomyTag.upsert({
      where: {
        regulatorId_facet_name: { regulatorId: regulator.id, facet: "SUBJECT", name: tag.name },
      },
      update: { shortCode: tag.shortCode, definition: tag.definition, status: tag.status, notes: tag.notes },
      create: {
        regulatorId: regulator.id,
        facet: "SUBJECT",
        name: tag.name,
        shortCode: tag.shortCode,
        definition: tag.definition,
        status: tag.status,
        versionAdded: "v1.0",
        notes: tag.notes,
      },
    });
    console.log(`  Subject: ${tag.name} (${tag.status})`);
  }

  for (const tag of INSTRUMENT_TYPE_TAGS) {
    await prisma.taxonomyTag.upsert({
      where: {
        regulatorId_facet_name: { regulatorId: regulator.id, facet: "INSTRUMENT_TYPE", name: tag.name },
      },
      update: { shortCode: tag.shortCode, definition: tag.definition },
      create: {
        regulatorId: regulator.id,
        facet: "INSTRUMENT_TYPE",
        name: tag.name,
        shortCode: tag.shortCode,
        definition: tag.definition,
        status: "ACTIVE",
        versionAdded: "v1.0",
      },
    });
    console.log(`  Instrument Type: ${tag.name}`);
  }

  await seedStandardStatusTags(regulator.id, "MTCTE");

  console.log("MTCTE taxonomy seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
