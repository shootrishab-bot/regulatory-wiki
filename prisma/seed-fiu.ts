/**
 * Seed script: FIU-IND (Financial Intelligence Unit - India) taxonomy.
 *
 * Creates/updates (idempotently, via upsert -- safe to re-run):
 *   1. The "Anti-Money Laundering" Domain (new).
 *   2. The "FIU" Regulator under that Domain.
 *   3. Every TaxonomyTag row for SUBJECT (12), INSTRUMENT_TYPE (12), and
 *      STATUS (7).
 *
 * Subject/Instrument Type/Status names and definitions are copied verbatim
 * from FIU_Regulatory_Taxonomy_v1_0.xlsx's Taxonomy sheet (repo root), WITH
 * ONE EXCEPTION: "Recruitment & Institutional Opportunities" (Subject) and
 * "Recruitment / Vacancy Notice" (Instrument Type) are NOT in that physical
 * workbook -- added here (versionAdded "v1.1 (proposed)") per
 * ../scrapers/fiu_scraper/taxonomy-findings.md's Finding 1, from a real
 * full-census pipeline run (2026-08-25, 518 real documents) that found
 * recruitment/vacancy content had come to make up ~99% of what landed on
 * "Institutional Governance & Administration" (107/518, ~21% of the whole
 * corpus) despite not being genuine internal-governance content, with no
 * Instrument Type fitting it at all. Same "code temporarily ahead of an
 * unedited workbook" pattern cci_scraper/__init__.py used for its own
 * "Not Applicable" Status addition -- the physical .xlsx is deliberately NOT
 * edited (see the build brief), only this seed and the findings doc. Short
 * codes are this file's own invention throughout -- the workbook has no
 * shortCode column, same situation seed-cci.ts and seed-dos-isro.ts were in.
 *
 * STATUS is a flat, unscoped vocabulary (statusAppliesToSubjectIds: [] for
 * every value), same pattern as seed-cci.ts and seed-dos-isro.ts. Uses a
 * bespoke 7-value Status list (not seedStandardStatusTags's 4-value shared
 * one) because the workbook itself defines 7, including "Under Litigation /
 * Stayed" and "Not Applicable" -- both deliberately reused verbatim from
 * CCI's own Status vocabulary for cross-regulator filtering consistency, per
 * the workbook's own Schema Note sheet.
 *
 * This regulator uses the wiki's own classification pipeline (lib/ingest.ts),
 * not fiu_scraper's standalone Python classifier.py -- same relationship
 * CCI's Postgres taxonomy has to cci_scraper's. NOTE: fiu_scraper's own
 * classifier.py/`__init__.py` were deliberately NOT updated to match this
 * addition -- that package loads its vocabulary directly from the unedited
 * .xlsx at runtime (see its own `__init__.py` docstring), so it stays on the
 * 11/11/7 v1.0 vocabulary until the physical workbook is actually revised.
 * This is a real, accepted asymmetry: fiu_scraper's own SQLite records won't
 * use the new tags, but that's harmless -- run_fiu_adapter.py never carries
 * subject/instrument_type forward from SQLite as ground truth; lib/ingest.ts
 * reclassifies every document fresh against THIS seed, which is what
 * actually reaches the wiki.
 *
 * Mirrors prisma/seed-cci.ts's structure and conventions.
 *
 * Run with:
 *   npx tsx prisma/seed-fiu.ts
 */

import "dotenv/config";
import { prisma } from "../lib/prisma";

const SUBJECT_TAGS: Array<{ name: string; shortCode: string; definition: string; versionAdded?: string }> = [
  {
    name: "Enforcement Actions & Penalties",
    shortCode: "ENF",
    definition:
      "The Director FIU-IND's real, operative Section 13 PMLA penalty and adjudication orders against reporting entities -- FIU-IND's core enforcement teeth, structurally the closest equivalent to a CCI Order.",
  },
  {
    name: "Reporting Entity Registration & Designation",
    shortCode: "REREG",
    definition:
      "Which entities are legally designated as PMLA 'reporting entities' with attendant obligations -- includes Ministry notifications bringing new categories (e.g. VDA Service Providers) within scope.",
  },
  {
    name: "AML/CFT Guidelines for Reporting Entities",
    shortCode: "GUIDE",
    definition:
      "FIU-IND's own detailed compliance guidance documents, issued per entity type or activity, elaborating specific practices required under PMLA and the PML Maintenance of Records Rules 2005.",
  },
  {
    name: "Virtual Digital Asset (VDA) Regulation",
    shortCode: "VDA",
    definition:
      "The specific, currently very active regulatory sub-area covering Virtual Digital Asset Service Providers -- registration, guidelines, and the enforcement actions against them. Kept as its own Subject rather than folded into the general Reporting Entity/Guidelines Subjects, since VDA-specific content is disproportionately large and newsworthy in the real corpus.",
  },
  {
    name: "PMLA Legislative Framework",
    shortCode: "PMLA",
    definition:
      "The Prevention of Money Laundering Act 2002 itself, its Rules, and the Scheduled Offences it incorporates -- the primary legislation FIU-IND administers, distinct from FIU-IND's own guidelines/orders which implement it.",
  },
  {
    name: "International Cooperation & FATF Compliance",
    shortCode: "INTL",
    definition:
      "FIU-IND's role in India's compliance with Financial Action Task Force (FATF) recommendations and cooperation with foreign financial intelligence units (the Egmont Group).",
  },
  {
    name: "Institutional Governance & Administration",
    shortCode: "GOV",
    definition:
      "Internal governance of FIU-IND -- Director appointments, organisational structure, internal administrative directives. Does NOT include recruitment/vacancy/staffing content -- see 'Recruitment & Institutional Opportunities' below, split out after a real pipeline run found this Subject had become ~99% recruitment content with almost no genuine governance content in it.",
  },
  {
    name: "Recruitment & Institutional Opportunities",
    shortCode: "RECRUIT",
    definition:
      "Job vacancies, deputation postings, and contractual staff/consultant engagement notices issued by FIU-IND -- kept as its own Subject rather than folded into Institutional Governance & Administration (where this content was landing by default) or merged into Procurement & Tenders (unlike CCI's equivalent combined Subject): a live pipeline run (2026-08-25, taxonomy-findings.md Finding 1) found recruitment content had come to dominate Institutional Governance & Administration (107/518 real documents, ~99% of that bucket) while the classifier correctly kept it distinct from real tender/RFP content even when cross-posted on the Tenders page -- staffing and procurement are semantically distinct.",
    versionAdded: "v1.1 (proposed)",
  },
  {
    name: "Procurement & Tenders",
    shortCode: "PROC",
    definition: "Tenders and RFPs issued by FIU-IND for goods, works, and services.",
  },
  {
    name: "Public Information & Transparency",
    shortCode: "RTI",
    definition: "RTI disclosures and FAQ content.",
  },
  {
    name: "Institutional Reporting & Annual Disclosures",
    shortCode: "AR",
    definition:
      "FIU-IND's own Annual Report and other periodic institutional disclosures -- distinct from the reporting entities' obligations to report to FIU-IND (covered under AML/CFT Guidelines for Reporting Entities).",
  },
  {
    name: "Public Communication & Outreach",
    shortCode: "OUTREACH",
    definition:
      "Press releases and announcements that are not themselves an enforcement order, guideline, or notification -- kept as its own Subject specifically so this content has somewhere real to land rather than being force-fit into a regulatory Subject or an enforcement-order Status, mirroring CCI's Advocacy & Outreach.",
  },
];

const INSTRUMENT_TYPE_TAGS: Array<{ name: string; shortCode: string; definition: string; versionAdded?: string }> = [
  { name: "Act", shortCode: "ACT", definition: "Primary legislation -- the Prevention of Money Laundering Act, 2002 itself." },
  {
    name: "Rules",
    shortCode: "RULES",
    definition: "Delegated legislation made under the Act -- chiefly the Prevention of Money-Laundering (Maintenance of Records) Rules, 2005.",
  },
  {
    name: "Notification",
    shortCode: "NOT",
    definition: "A Ministry (not FIU-IND itself) notification, typically designating a new category of entity as a 'reporting entity' under the Act.",
  },
  {
    name: "Guidelines",
    shortCode: "GUIDE",
    definition:
      "FIU-IND's own detailed compliance guidance for a specific entity type or activity -- distinct from a Circular (procedural/administrative) and a Notification (Ministry-issued, designates scope rather than explaining compliance).",
  },
  {
    name: "Circular",
    shortCode: "CIRC",
    definition: "A procedural or administrative circular issued by FIU-IND -- registration processes, reporting-format changes, and similar operational instructions to reporting entities.",
  },
  {
    name: "Adjudication / Penalty Order",
    shortCode: "ORDER",
    definition: "A real, operative order by the Director FIU-IND under Section 13 PMLA imposing a monetary penalty or other sanction on a named reporting entity -- FIU-IND's core enforcement output.",
  },
  { name: "Press Release", shortCode: "PR", definition: "An announcement of an enforcement action, policy change, or institutional event." },
  { name: "FAQ", shortCode: "FAQ", definition: "Static frequently-asked-questions content with real substantive compliance guidance." },
  { name: "Tender / RFP", shortCode: "TND", definition: "A procurement tender or RFP issued by FIU-IND." },
  { name: "Annual Report", shortCode: "AR", definition: "FIU-IND's own annual report." },
  {
    name: "RTI Response / Disclosure",
    shortCode: "RTID",
    definition: "Suo-motu disclosures and RTI-related content.",
  },
  {
    name: "Recruitment / Vacancy Notice",
    shortCode: "VACANCY",
    definition: "A job vacancy, deputation posting, or contractual engagement/consultant notice issued by FIU-IND.",
    versionAdded: "v1.1 (proposed)",
  },
];

const STATUS_TAGS: Array<{ name: string; shortCode: string; definition: string }> = [
  {
    name: "In Force",
    shortCode: "INF",
    definition: "The instrument is currently operative -- an unrevoked, unstayed penalty order, or a currently valid Act/Rule/Guideline/Notification.",
  },
  {
    name: "Draft / Under Consultation",
    shortCode: "DFT",
    definition: "The instrument is genuinely unfinalised and pending -- reserved for real instruments awaiting finalisation, not for press releases or outreach content.",
  },
  { name: "Superseded", shortCode: "SUP", definition: "The instrument has been fully replaced by a later version." },
  { name: "Amended", shortCode: "AMD", definition: "The instrument's terms have been revised without a full replacement." },
  { name: "Repealed", shortCode: "REP", definition: "The instrument has been withdrawn without a direct replacement." },
  {
    name: "Under Litigation / Stayed",
    shortCode: "LIT",
    definition:
      "An enforcement order (Adjudication/Penalty Order) that is under appeal to the Appellate Tribunal, or otherwise stayed, per the real Section 26 PMLA appeal mechanism. Naming reused from CCI's identical Status tag for cross-regulator consistency.",
  },
  {
    name: "Not Applicable",
    shortCode: "NA",
    definition:
      "The Status facet does not meaningfully describe this content -- press releases, outreach, and other non-instrument content (including FIU-IND's own periodic institutional disclosures, e.g. its Annual Report). Adopted directly from CCI's v1.3 correction.",
  },
];

async function main() {
  console.log("Seeding FIU-IND taxonomy...");

  const domain = await prisma.domain.upsert({
    where: { name: "Anti-Money Laundering" },
    update: {},
    create: {
      name: "Anti-Money Laundering",
      description: "India's anti-money-laundering / counter-terrorist-financing regulatory regime, administered by the Financial Intelligence Unit - India (FIU-IND) under the Prevention of Money Laundering Act, 2002.",
    },
  });
  console.log(`Domain "Anti-Money Laundering" ready (id: ${domain.id})`);

  const regulator = await prisma.regulator.upsert({
    where: { code: "FIU" },
    update: { domainId: domain.id },
    create: {
      code: "FIU",
      name: "Financial Intelligence Unit - India",
      domainId: domain.id,
      websiteUrl: "https://fiuindia.gov.in",
    },
  });
  console.log(`Regulator "FIU" ready (id: ${regulator.id})`);

  for (const tag of SUBJECT_TAGS) {
    await prisma.taxonomyTag.upsert({
      where: { regulatorId_facet_name: { regulatorId: regulator.id, facet: "SUBJECT", name: tag.name } },
      update: { shortCode: tag.shortCode, definition: tag.definition },
      create: {
        regulatorId: regulator.id,
        facet: "SUBJECT",
        name: tag.name,
        shortCode: tag.shortCode,
        definition: tag.definition,
        status: "ACTIVE",
        versionAdded: tag.versionAdded ?? "v1.0",
      },
    });
    console.log(`  Subject: ${tag.name}`);
  }

  for (const tag of INSTRUMENT_TYPE_TAGS) {
    await prisma.taxonomyTag.upsert({
      where: { regulatorId_facet_name: { regulatorId: regulator.id, facet: "INSTRUMENT_TYPE", name: tag.name } },
      update: { shortCode: tag.shortCode, definition: tag.definition },
      create: {
        regulatorId: regulator.id,
        facet: "INSTRUMENT_TYPE",
        name: tag.name,
        shortCode: tag.shortCode,
        definition: tag.definition,
        status: "ACTIVE",
        versionAdded: tag.versionAdded ?? "v1.0",
      },
    });
    console.log(`  Instrument Type: ${tag.name}`);
  }

  for (const tag of STATUS_TAGS) {
    await prisma.taxonomyTag.upsert({
      where: { regulatorId_facet_name: { regulatorId: regulator.id, facet: "STATUS", name: tag.name } },
      update: { shortCode: tag.shortCode, definition: tag.definition, statusAppliesToSubjectIds: [] },
      create: {
        regulatorId: regulator.id,
        facet: "STATUS",
        name: tag.name,
        shortCode: tag.shortCode,
        definition: tag.definition,
        status: "ACTIVE",
        versionAdded: "v1.0",
        statusAppliesToSubjectIds: [],
      },
    });
    console.log(`  Status: ${tag.name}`);
  }

  console.log("FIU-IND taxonomy seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
