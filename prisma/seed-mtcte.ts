/**
 * Seed script: MTCTE (Mandatory Testing and Certification of Telecommunication
 * Equipment) taxonomy.
 *
 * Creates/updates (idempotently, via upsert — safe to re-run):
 *   1. The "Telecom" Domain — REUSES the same Domain row as seed-dot.ts
 *      (upsert by name, not create), it does not create a second Telecom
 *      domain.
 *   2. The "MTCTE" Regulator under that Domain.
 *   3. Every TaxonomyTag row for MTCTE's SUBJECT and INSTRUMENT_TYPE facets,
 *      built bottom-up from the real 151-document deduplicated dataset
 *      produced by mtcte_adapter.py's date-aware cross-source dedup — every
 *      "Confirmed" tag below has real title evidence behind it from that
 *      list, matching the same evidence-based approach as seed-dot.ts.
 *
 * IMPORTANT: this imports the shared Prisma client singleton from
 * lib/prisma.ts (same pattern as seed-dot.ts) rather than instantiating a
 * new PrismaClient here — do not create a second client instance.
 *
 * Run with:
 *   npx tsx prisma/seed-mtcte.ts
 */

import "dotenv/config"; // required when run standalone via tsx — see seed-dot.ts's
                          // note: lib/prisma.ts reads process.env.DATABASE_URL
                          // directly and a bare script has nothing else loading .env
import { prisma } from "../lib/prisma";

// ---------------------------------------------------------------------------
// SUBJECT taxonomy — the 8 candidate categories pressure-tested against the
// real 151-document deduplicated MTCTE dataset, plus 1 UNDER_REVIEW tag.
// ---------------------------------------------------------------------------
const SUBJECT_TAGS: Array<{
  name: string;
  shortCode: string;
  definition: string;
  parentName: string | null;
  status: "ACTIVE" | "UNDER_REVIEW";
  notes?: string;
}> = [
  {
    name: "Essential Requirements & Product Categories",
    shortCode: "ERPC",
    definition:
      "Which telecom products/equipment are notified under MTCTE, which phase/category they fall into, and how products are classified or re-classified.",
    parentName: null,
    status: "ACTIVE",
    notes:
      "Real evidence: 'Notification of the products covered under Phase V of MTCTE', 'Notification of WiFi CPE and IP Router including security testing', 'Classification of Family and Associated Models of Optical Fibre Cable', 'Re-categorization of notified products as GCS and SCs category', 'De-notification of Hybrid Set Top Box from the scope of MTCTE', 'Multiple applications for the same equipment with the same model number', 'Addition of Associated Model(s) in already Certified Equipment'.",
  },
  {
    name: "Conformity Assessment Bodies & Test Labs",
    shortCode: "CABTL",
    definition:
      "CAB designation, test lab accreditation/facility details, and acceptance of test reports/certificates issued by CABs or accredited labs.",
    parentName: null,
    status: "ACTIVE",
    notes:
      "Real evidence: 'Extension in Validity of CAB Designation', 'Labs' Facility Information for MTCTE Phase I and Phase II Roll-out', 'List of TEC designated labs viz-a-viz test parameters of products', 'Acceptance of ILAC test reports under MTCTE' (recurring, 6+ distinct dated filings), 'Acceptance of Source Approval Certificate (SAC) under MTCTE', 'Letter to all CABs and NABL Accredited Labs for uploading of Test Report Summary'.",
  },
  {
    name: "Exemptions",
    shortCode: "EXM",
    definition:
      "Exemption, relaxation, or extension of exemption from specific ER parameters/interfaces — the recurring periodic-reissue circulars, as distinct from the underlying product/ER notification itself.",
    parentName: null,
    status: "ACTIVE",
    notes:
      "Real evidence: 'Exemption pertaining to various parameters/ Interfaces of ERs under MTCTE' alone recurs as 15 distinct dated filings (2022-08-24 through 2026-07-01, confirmed via mtcte_adapter.py's date-aware dedup fix — title-only matching had wrongly collapsed these into one before the fix). Also 'Exemption pertaining to parameters of LAN Switch/PTP PMP/Session Border Controller/Repeater/Media Gateway under MTCTE', GPS parameter exemption + its corrigendum, PON family exemption (7 distinct dated filings), Optical Fibre exemption family.",
  },
  {
    name: "Testing & Certification Procedure",
    shortCode: "TCP",
    definition:
      "The MTCTE procedure document itself, its versions/amendments, and user instructions for applicants, CAB testing officers, and other procedure participants.",
    parentName: null,
    status: "ACTIVE",
    notes:
      "Real evidence: 'MTCTE Procedure ver 2.0', 'MTCTE procedure (ver 2.1/ Rel. May 2021)...', 'MTCTE Procedure (v3.0/ Rel. April 2024)', 'Amendment in MTCTE Procedure v3.0 (TEC 93009:2024)' and its 'Amendment 2.0' + 'Amendment of Clauses 17.2' follow-ups, 'MTCTE User Instructions V 3.0', 'MTCTE Applicant User Instructions', 'CAB Testing officer User Instructions', 'Enhancement of validity of Regular MTCTE Certificate from 5 years to 10 years'.",
  },
  {
    name: "Appeals",
    shortCode: "APL",
    definition: "Appeal handling process against MTCTE certification decisions.",
    parentName: null,
    status: "ACTIVE",
    notes:
      "Real evidence: 'Handling of Appeal received from Applicant w.r.t. MTCTE Certificates-reg.' (2022-08-24) and 'Handling of Appeals under MTCTE regime' recurring as 2 further distinct dated filings (2024-02-13, 2024-10-25) — a real recurring topic, not a one-off.",
  },
  {
    name: "Certificate Terms & Conditions",
    shortCode: "CTC",
    definition: "The terms, conditions, validity period, and labelling requirements attached to an issued MTCTE certificate.",
    parentName: null,
    status: "ACTIVE",
    notes:
      "Real evidence: 'MTCTE Certificate Terms and Conditions', 'Enhancement of validity of Regular MTCTE Certificate from 5 years to 10 years', 'Notification for Requirement of Labelling on Certified Product', 'Revision of labelling guidelines in MTCTE procedure' (2 distinct dated revisions).",
  },
  {
    name: "Security Certification",
    shortCode: "SEC",
    definition:
      "Security-specific certification requirements for network/CPE equipment — a distinct certification track layered on top of standard MTCTE certification.",
    parentName: null,
    status: "ACTIVE",
    notes:
      "Real evidence: 'Security Certification for IP Router and WiFi CPE Products', 'Security Certification of Optical Network Terminal (ONT) and Optical Line Terminal (OLT) under ComSec scheme', 'Notification of revised TEC standards for Essential Requirements of SIM and IP Security Equipment', 'Exemption of Cloud implemented IP Routers and Wi-Fi CPEs from Security Certification', 'Clarification on Security certification for End of Sale (EoS) and End of Life (EoL) products'.",
  },
  {
    name: "Governance and Rulemaking",
    shortCode: "GOV",
    definition: "Statutory rules/frameworks governing MTCTE itself and public consultation on the MTCTE procedure.",
    parentName: null,
    status: "ACTIVE",
    notes:
      "Real evidence: 'Draft \"Telecommunications (Standards, Conformity Assessment and Certification) Rules, 2025\"' and the notified 'Telecommunications (Framework to Notify Standards, Conformity Assessment and Certification) Rules, 2025' that followed it, 'Seeking inputs/suggestions on MTCTE procedure v3.0 (TEC 93009:2024)'.",
  },
  {
    name: "Voluntary Certification Scheme",
    shortCode: "VCS",
    definition:
      "Voluntary (non-mandatory) security certification for IP Router/WiFi CPE, and the separate voluntary-certification procedure page linked from the MTCTE homepage.",
    parentName: null,
    status: "UNDER_REVIEW",
    notes:
      "PLACEHOLDER — real evidence exists ('Voluntary Security Certification for IP Router and WiFi CPE', dated 2023-08-25) but the homepage's 'Click here for Voluntary Certification procedure and other related documents' item links OUT to a different TEC scheme page (https://www.tec.gov.in/voluntary-testing-certification), not an MTCTE-internal document — open question whether this belongs as a first-class MTCTE Subject tag or should be dropped/cross-referenced instead. Revisit once that external scheme's own scope is confirmed.",
  },
];

// ---------------------------------------------------------------------------
// INSTRUMENT TYPE taxonomy — built from real title patterns in the same
// 151-document dataset.
// ---------------------------------------------------------------------------
const INSTRUMENT_TYPE_TAGS: Array<{ name: string; shortCode: string; definition: string }> = [
  {
    name: "Notification",
    shortCode: "NOT",
    definition: "A notification of products, phases, or equipment under MTCTE.",
  },
  {
    name: "Circular / Office Memorandum",
    shortCode: "CIR",
    definition: "General administrative circulars and letters, e.g. 'Regarding...', 'Letter to Designated CABs...'.",
  },
  {
    name: "Procedure Document",
    shortCode: "PROC",
    definition: "The MTCTE Procedure document itself or a formal amendment to it (as distinct from a one-off clarification).",
  },
  {
    name: "Exemption / Relaxation Order",
    shortCode: "EXO",
    definition: "A specific grant of exemption or relaxation from one or more ER parameters/interfaces.",
  },
  {
    name: "Clarification",
    shortCode: "CLR",
    definition: "A clarification issued in response to a specific query or ambiguity, e.g. 'Clarification regarding testing of Base Station for Cellular Network'.",
  },
  {
    name: "Rules",
    shortCode: "RUL",
    definition: "Statutory rules (draft or notified) governing MTCTE, e.g. the Telecommunications (Framework to Notify Standards, Conformity Assessment and Certification) Rules, 2025.",
  },
  {
    name: "FAQ",
    shortCode: "FAQ",
    definition: "A frequently-asked-questions document, e.g. 'FAQ_1 : PON ER (FA division)'.",
  },
  {
    name: "Proforma / Form",
    shortCode: "FORM",
    definition: "A fillable proforma or file-format specification, e.g. 'Performa for seeking of Non-Applicability for few parameters', 'Bill of Material (BOM) File Format'.",
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
      name: "Mandatory Testing and Certification of Telecommunication Equipment (TEC)",
      domainId: domain.id,
      websiteUrl: "https://www.mtcte.tec.gov.in",
    },
  });
  console.log(`Regulator "MTCTE" ready (id: ${regulator.id})`);

  // Subject tags: parents first, then children (so parentId can resolve).
  const subjectIdByName = new Map<string, string>();
  const parentsFirst = [...SUBJECT_TAGS].sort((a, b) =>
    a.parentName === null && b.parentName !== null ? -1 : a.parentName !== null && b.parentName === null ? 1 : 0
  );

  for (const tag of parentsFirst) {
    const parentId = tag.parentName ? subjectIdByName.get(tag.parentName) ?? null : null;
    if (tag.parentName && !parentId) {
      throw new Error(
        `Parent tag "${tag.parentName}" not found/not yet created for child "${tag.name}" — check SUBJECT_TAGS ordering.`
      );
    }

    const created = await prisma.taxonomyTag.upsert({
      where: {
        regulatorId_facet_name: {
          regulatorId: regulator.id,
          facet: "SUBJECT",
          name: tag.name,
        },
      },
      update: {
        shortCode: tag.shortCode,
        definition: tag.definition,
        parentId,
        status: tag.status,
        notes: tag.notes,
      },
      create: {
        regulatorId: regulator.id,
        facet: "SUBJECT",
        name: tag.name,
        shortCode: tag.shortCode,
        definition: tag.definition,
        parentId,
        status: tag.status,
        versionAdded: "v1.0",
        notes: tag.notes,
      },
    });
    subjectIdByName.set(tag.name, created.id);
    console.log(`  Subject: ${tag.name} (${tag.status})`);
  }

  // Instrument Type tags — all flat, no hierarchy for MTCTE currently.
  for (const tag of INSTRUMENT_TYPE_TAGS) {
    await prisma.taxonomyTag.upsert({
      where: {
        regulatorId_facet_name: {
          regulatorId: regulator.id,
          facet: "INSTRUMENT_TYPE",
          name: tag.name,
        },
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
