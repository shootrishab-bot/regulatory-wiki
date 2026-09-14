/**
 * Seed script: CPPP (Central Public Procurement Portal) taxonomy.
 *
 * Sourced verbatim from CPPP_Tenders_Taxonomy_v1_1.xlsx's Taxonomy sheet --
 * 7 Subjects, 9 Instrument Types, 6 Status values.
 *
 * v1.1 (2026-09-10) is the first version backed by a real pipeline run: 6,097
 * rows scraped from eprocure.gov.in/cppp, a population-weighted random sample
 * of 100 classified against v1.0, plus all 89 institutional documents as a
 * supplementary pass (a correctly-weighted 100 cannot reach content that is
 * 0.3% of the corpus). Evidence: scrapers/cppp-taxonomy-findings.md and the
 * workbook's Change Log sheet.
 *
 * Unlike MERC, whose v1.0 needed eight new Instrument Types, CPPP's v1.0
 * vocabulary largely matched its corpus -- 4 of 100 flagged. The v1.1 changes
 * are one added tag (Report / Statistics), four tags labelled unreachable,
 * and six definitions tightened. Nothing was deprecated or renamed.
 *
 * FOUR TAGS ARE UNREACHABLE FROM THE PUBLIC PORTAL and say so in their own
 * definitions: Award of Contract (AoC), Cancelled, Retendered and
 * Awarded / Closed. Every route to them -- cppp/resultoftendersnew,
 * cppp/cancelledtenders, cppp/tendersfullview, cppp/corrigfullview, and every
 * GePNIC eprocure/app equivalent -- is CAPTCHA-gated, verified live twice.
 * They are kept ACTIVE rather than DEPRECATED deliberately: they describe real
 * things CPPP publishes, an authenticated feed would restore them, and the run
 * showed no risk of the classifier reaching for them wrongly (0 fires in 189
 * documents, because status_hint pins every tender-feed row before the
 * classifier is consulted).
 *
 * CPPP is structurally unlike every regulator seeded so far: it is a mandatory
 * tender-PUBLISHING platform (NIC-hosted, mandatory since the Department of
 * Expenditure O.M. of 30 November 2011 for procurement above Rs 2 lakh), not a
 * rule-making or enforcement body. Its Status vocabulary therefore departs
 * deliberately from the In Force / Draft / Superseded / Amended / Repealed set
 * every other regulator uses, and models a TENDER lifecycle instead: Live /
 * Open -> Corrigendum Issued -> Cancelled | Retendered | Awarded / Closed.
 * The workbook's own Schema Note flags this as a deliberate divergence rather
 * than an oversight, and it is preserved here exactly.
 *
 * Consequently this does NOT use seed-shared.ts's seedStandardStatusTags():
 * none of those four values means anything for a tender.
 *
 * The vocabulary is flat and unscoped (statusAppliesToSubjectIds: [] on every
 * value), matching every regulator except DST. Note that the taxonomy's own
 * Tagging Guide rule 3 is effectively a Subject-scoping rule in prose --
 * institutional Subjects (Procurement Policy & Framework, Platform
 * Administration & Onboarding, Public Information & Transparency) can only
 * ever be "Not Applicable". Whether to encode that as a real
 * statusAppliesToSubjectIds scope, the way DST does, is a live question and is
 * evaluated against real classified data in cppp-taxonomy-findings.md rather
 * than assumed here at seed time.
 *
 * Run with:
 *   npx tsx prisma/seed-cppp.ts
 */

import "dotenv/config";
import { prisma } from "../lib/prisma";

// Stamped on every tag this script writes. Bump with the workbook.
const TAXONOMY_VERSION = "v1.1";

const SUBJECT_TAGS: Array<{ name: string; shortCode: string; definition: string }> = [
  {
    name: "Goods Procurement",
    shortCode: "GOODS",
    definition:
      "Tenders for the purchase of goods/equipment, per GFR 2017's own standard procurement-category classification. Applies ONLY to an actual procurement transaction (a Tender Notice, Corrigendum, or Award of Contract) -- a manual, model document, circular or O.M. ABOUT procuring goods takes Procurement Policy & Framework, however prominently 'Goods' appears in its title.",
  },
  {
    name: "Works Procurement",
    shortCode: "WORKS",
    definition:
      "Tenders for civil works, construction, and infrastructure contracts. Applies ONLY to an actual procurement transaction (a Tender Notice, Corrigendum, or Award of Contract) -- a manual, model document, circular or O.M. ABOUT procuring works takes Procurement Policy & Framework.",
  },
  {
    name: "Consultancy Services Procurement",
    shortCode: "CONS",
    definition:
      "Tenders for professional/consultancy services. Applies ONLY to an actual procurement transaction (a Tender Notice, Corrigendum, or Award of Contract) -- a manual, model document, circular or O.M. ABOUT procuring consultancy services takes Procurement Policy & Framework.",
  },
  {
    name: "Non-Consultancy Services Procurement",
    shortCode: "NCONS",
    definition:
      "Tenders for non-consultancy services (operational, maintenance, and similar service contracts). Applies ONLY to an actual procurement transaction (a Tender Notice, Corrigendum, or Award of Contract) -- a manual, model document, circular or O.M. ABOUT procuring such services takes Procurement Policy & Framework.",
  },
  {
    name: "Procurement Policy & Framework",
    shortCode: "POLFW",
    definition:
      "The rules governing procurement itself -- GFR 2017, the Manual for Procurement of Goods/Works/Services, preference policies (e.g. Public Procurement (Preference to Make in India) Order 2017), and the founding CPPP mandate itself.",
  },
  {
    name: "Platform Administration & Onboarding",
    shortCode: "PLAT",
    definition:
      "Operational guidance for how Central Government entities and their Nodal Officers actually use CPPP -- onboarding letters, user-role guidelines, default portal properties.",
  },
  {
    name: "Public Information & Transparency",
    shortCode: "RTI",
    // Widened 2026-09-11, together with Report / Statistics' definition below.
    // v1.1 left this as RTI-only, so a statistics report had no Subject that
    // described it and the model once put the Instrument Type name in the
    // Subject slot (cppp-taxonomy-findings.md, Finding 8). Measured on 30 real
    // newsletter-feed documents x2 runs: 28 flags -> 10, the 10 remaining all
    // text_extraction_failed.
    definition:
      "Content whose purpose is to inform the public about procurement activity or about CPPP itself, rather than to procure something or to set procurement rules: CPPP's monthly Tender Statistical Reports, its Annual Reports, its newsletters, and RTI / suo-motu transparency disclosures. Every Report / Statistics document takes this Subject.",
  },
];

const INSTRUMENT_TYPE_TAGS: Array<{ name: string; shortCode: string; definition: string }> = [
  {
    name: "Tender Notice (NIT)",
    shortCode: "NIT",
    definition:
      "A Notice Inviting Tender -- the original real tender enquiry as published by a Central Government entity.",
  },
  {
    name: "Corrigendum",
    shortCode: "CORR",
    definition:
      "An amendment to an already-published Tender Notice. Real confirmed subtypes exist (a critical-date change, a cancellation, or a retender) but are NOT observable from the public listing, which shows the underlying TENDER's title rather than what the corrigendum changed -- so Corrigendum Issued is both the correct default and a known floor, never a confident finding that the tender is merely amended.",
  },
  {
    name: "Award of Contract (AoC)",
    shortCode: "AOC",
    definition:
      "The real record of a tender's outcome once a contract has been awarded. NOT REACHABLE from the public portal: CPPP's Result of Tenders page is CAPTCHA-gated, and so is the GePNIC Bid Awards page that would otherwise serve as an alternative route.",
  },
  {
    name: "Circular / Office Memorandum",
    shortCode: "OM",
    definition:
      "A procurement-policy circular or OM, distinct from a Tender Notice -- includes the founding CPPP mandate itself. Decided against Manual / Guidelines by FORM, not topic: a numbered, dated issuance addressed to ministries and departments belongs here even when its subject is a manual.",
  },
  {
    name: "Manual / Guidelines",
    shortCode: "MAN",
    definition:
      "A substantive procurement-procedure manual, such as the GFR 2017's Manual for Procurement of Goods/Works/Services, or CPPP's own onboarding/operational guidelines document. Decided against Circular / Office Memorandum by FORM, not topic: a standalone reference document meant to be consulted rather than circulated belongs here.",
  },
  {
    name: "Press Release",
    shortCode: "PR",
    definition:
      "An announcement, award recognition, or institutional communication -- CPPP/GePNIC has received real award recognitions (CSI Nihilent eGovernance Award, eIndia Award), which fall here rather than under any procurement Subject. Does NOT cover CPPP's monthly Tender Statistical Reports or its Annual Reports -- those are Report / Statistics.",
  },
  { name: "FAQ", shortCode: "FAQ", definition: "Static frequently-asked-questions content." },
  {
    name: "RTI Response / Disclosure",
    shortCode: "RTID",
    definition: "Suo-motu disclosures and RTI-related content.",
  },
  // ---- added in v1.1, from the real 2026-09-10 run ------------------------
  {
    name: "Report / Statistics",
    shortCode: "RPT",
    // Reworded 2026-09-11 to lead with FORM rather than topic: "a data
    // publication about procurement activity" read as a Subject once
    // definitions reached the prompt. See Public Information & Transparency.
    definition:
      "A document FORM, not a topic: a periodic statistical report, an annual report, or a newsletter that publishes aggregate data about procurement activity rather than about one specific tender -- CPPP's monthly Tender Statistical Reports and its Annual Reports. This is an Instrument Type value only and is never a Subject; its Subject is Public Information & Transparency. Distinct from Press Release, which is an announcement or recognition.",
  },
];

const STATUS_TAGS: Array<{ name: string; shortCode: string; definition: string }> = [
  {
    name: "Live / Open",
    shortCode: "LIVE",
    definition:
      "The tender is currently published and accepting bids -- the default state of a freshly published Tender Notice.",
  },
  {
    name: "Corrigendum Issued",
    shortCode: "CORRI",
    definition:
      "The tender has been amended (a date change or other non-cancelling correction) since original publication, and remains open under the amended terms.",
  },
  {
    name: "Cancelled",
    shortCode: "CANC",
    definition:
      "The tender has been withdrawn via a real Cancellation-type corrigendum. NOT REACHABLE from the public portal: the cancelled-tenders listing is CAPTCHA-gated, and a corrigendum's subtype lives on the CAPTCHA-gated corrigendum detail page.",
  },
  {
    name: "Retendered",
    shortCode: "RETEN",
    definition:
      "The original tender was withdrawn and re-floated as a new tender process via a real Retender-type corrigendum. NOT REACHABLE from the public portal, for the same reason as Cancelled: the corrigendum subtype is only on the CAPTCHA-gated detail page.",
  },
  {
    name: "Awarded / Closed",
    shortCode: "AWD",
    definition:
      "The tender process has concluded with a real, published Award of Contract. NOT REACHABLE from the public portal: it depends on the CAPTCHA-gated Result of Tenders listing.",
  },
  {
    name: "Not Applicable",
    shortCode: "NA",
    definition:
      "The Status facet does not meaningfully describe this content -- Circulars, Manuals, FAQs, and Press Releases are not tenders and have no Live/Corrigendum/Cancelled/Awarded lifecycle. Adopted directly from the CCI v1.3 / DOS-ISRO / FIU-IND precedent for non-instrument content, applied here from v1.0.",
  },
];

async function main() {
  console.log("Seeding CPPP taxonomy...");

  const domain = await prisma.domain.upsert({
    where: { name: "Public Procurement" },
    update: {},
    create: {
      name: "Public Procurement",
      description:
        "Central government public procurement -- the mandatory tender-publishing platform and the GFR/Manual policy framework it sits on.",
    },
  });
  console.log(`Domain "Public Procurement" ready (id: ${domain.id})`);

  const regulator = await prisma.regulator.upsert({
    where: { code: "CPPP" },
    update: { domainId: domain.id },
    create: {
      code: "CPPP",
      name: "Central Public Procurement Portal",
      domainId: domain.id,
      websiteUrl: "https://eprocure.gov.in/cppp/",
    },
  });
  console.log(`Regulator "CPPP" ready (id: ${regulator.id})`);

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
        versionAdded: TAXONOMY_VERSION,
      },
    });
    console.log(`  Subject: ${tag.name}`);
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
        versionAdded: TAXONOMY_VERSION,
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
        versionAdded: TAXONOMY_VERSION,
        statusAppliesToSubjectIds: [], // flat vocabulary -- see module docstring
      },
    });
    console.log(`  Status: ${tag.name}`);
  }

  console.log("CPPP taxonomy seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
