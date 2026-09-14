/**
 * Seed script: MERC (Maharashtra Electricity Regulatory Commission) taxonomy.
 *
 * Sourced verbatim from MERC_Regulatory_Taxonomy_v1_1.xlsx's Taxonomy sheet --
 * 9 Subjects, 18 Instrument Types, 7 Status values. Definitions are the
 * workbook's own, not paraphrased, so a later diff against the workbook is
 * meaningful.
 *
 * v1.1 (2026-09-10) is the first version of this taxonomy backed by a real
 * pipeline run rather than research: 20,740 real documents scraped from
 * merc.gov.in, a uniform random sample of 100 classified against v1.0, and
 * the results read back. Eight Instrument Types added, seven tags revised.
 * Evidence for every change is in scrapers/merc-taxonomy-findings.md and in
 * the workbook's own Change Log sheet. The headline correction: roughly 60%
 * of what MERC publishes is procedural case management (48.2% hearing
 * notices, 11.8% Daily Orders) and v1.0 had no Instrument Type for any of
 * it, which drove 40% of the sample into the review queue.
 *
 * MERC is the FIRST state-level regulator in this project; every other one is
 * a central/national body. The workbook's own Schema Note flags this as an
 * open scoping question (single representative state, or the first of many?)
 * and deliberately does not answer it. Nothing here answers it either -- the
 * Domain is named "Electricity" rather than "Maharashtra ..." precisely so
 * that adding CERC (whose adapter already exists in scrapers/) or another
 * SERC later does not require renaming a Domain.
 *
 * STATUS is a flat, unscoped vocabulary (statusAppliesToSubjectIds: [] on
 * every value) -- the same shape as DOS-ISRO and every other regulator except
 * DST. It does NOT use seed-shared.ts's seedStandardStatusTags(): that helper
 * collapses Superseded and Repealed into one tag and has neither "Not
 * Applicable" nor "Under Litigation / Stayed", and this workbook keeps all
 * four as separate real values from v1.0.
 *
 * Run with:
 *   npx tsx prisma/seed-merc.ts
 */

import "dotenv/config";
import { prisma } from "../lib/prisma";

// Stamped on every tag this script writes. Bump with the workbook.
const TAXONOMY_VERSION = "v1.1";

const SUBJECT_TAGS: Array<{ name: string; shortCode: string; definition: string }> = [
  {
    name: "Tariff Determination",
    shortCode: "TARIFF",
    definition:
      "Annual Revenue Requirement (ARR) and tariff-setting proceedings for distribution licensees (MSEDCL, Tata Power, Adani Electricity, BEST, and others) under Section 62 of the Electricity Act.",
  },
  {
    name: "Renewable Energy & RPO",
    shortCode: "RE",
    definition:
      "Renewable Purchase Obligation (RPO) compliance, REC framework implementation, and renewable-specific tariff determination -- kept as its own Subject given the real, distinct volume of Regulations and Orders specifically about this area found during research.",
  },
  {
    name: "Standards of Performance & Consumer Protection",
    shortCode: "SOP",
    definition:
      "Service-quality standards for distribution licensees and the consumer grievance-redressal mechanism (the Forum and the Electricity Ombudsman) under Sections 59, 142, and 146 of the Electricity Act.",
  },
  {
    name: "Licensing",
    shortCode: "LIC",
    definition: "Generation, transmission, and distribution licensing and related conditions.",
  },
  {
    name: "Regulatory Framework & Rulemaking",
    shortCode: "REGFW",
    definition:
      "MERC's own subordinate legislation -- the Multi Year Tariff (MYT) Regulations and other cross-cutting Regulations not specific to renewables or standards of performance -- and draft versions of these put out for public consultation.",
  },
  {
    name: "Competition & Open Access",
    shortCode: "OA",
    definition:
      "MERC's function to 'promote competition, efficiency and economy in the power sector' -- open access, captive power arrangements, and related market-structure matters.",
  },
  {
    name: "Institutional Governance & Administration",
    shortCode: "GOV",
    definition:
      "Internal governance and administration of MERC -- Commission composition (Chairperson/Members), appointments, organisational matters, advisory-committee constitution and minutes, the Commission's own procurement, and its own staff recruitment.",
  },
  {
    name: "Public Information & Transparency",
    shortCode: "RTI",
    definition: "RTI disclosures and related transparency content.",
  },
  {
    name: "Public Communication & Outreach",
    shortCode: "OUTR",
    definition:
      "Press releases and institutional announcements with no operative regulatory content of their own -- genuinely informational communication. NOT the default for anything published through MERC's Press Release section: most of that section is statutory notices inviting objections on specific licence or tariff applications, which take the Subject of the underlying matter.",
  },
];

const INSTRUMENT_TYPE_TAGS: Array<{ name: string; shortCode: string; definition: string }> = [
  {
    name: "Act",
    shortCode: "ACT",
    definition: "The Electricity Act, 2003 itself -- the primary legislation MERC operates under.",
  },
  {
    name: "Regulations",
    shortCode: "REG",
    definition:
      "MERC's own subordinate legislation -- real named examples include the MYT Regulations 2019, the RE Tariff Regulations 2015, the RPO/REC Regulations 2010 and 2016, and the Standards of Performance Regulations 2021.",
  },
  {
    name: "Order",
    shortCode: "ORD",
    definition:
      "A real, operative case-specific Order disposing of a petition -- tariff determinations, RPO compliance orders, competition/open-access matters. MERC's core adjudicatory output, structurally the closest equivalent to a CCI Order. Does NOT cover a Daily Order, which records hearing proceedings in a case that remains pending.",
  },
  {
    name: "Draft Order",
    shortCode: "DORD",
    definition:
      "An Order issued in draft form specifically for public/stakeholder consultation before finalisation, kept distinct from a final Order.",
  },
  {
    name: "Corrigendum Order",
    shortCode: "CORR",
    definition:
      "A real, operative correction to an already-issued final Order -- distinct from a fresh Order, and distinct from a Draft Order.",
  },
  {
    name: "Public Notice / Consultation Notice",
    shortCode: "PN",
    definition:
      "A notice inviting stakeholder comments on a draft Regulation, a draft Order, or a specific pending application (a licence application, a tariff petition) -- addressed to the public at large. Distinct from a Hearing Notice, which is addressed to the named parties in a numbered case and directs them to appear rather than inviting comment.",
  },
  {
    name: "Press Release",
    shortCode: "PR",
    definition: "An announcement or institutional communication.",
  },
  {
    name: "Annual Report",
    shortCode: "AR",
    definition:
      "MERC's own annual administration report and annual accounts report. Does NOT cover periodic or quarterly compliance data, or sector studies -- those are Report.",
  },
  { name: "FAQ", shortCode: "FAQ", definition: "Static frequently-asked-questions content." },
  {
    name: "RTI Response / Disclosure",
    shortCode: "RTID",
    definition: "Suo-motu disclosures and RTI-related content.",
  },
  // ---- added in v1.1, from the real 2026-09-10 run ------------------------
  // Hearing Notice and Daily Order each name their own MERC section as of
  // 2026-09-11. Once definitions reached the classifier, title-only hearing
  // rows titled with the petition ("Petition of M/s Adani Power ... for the
  // assignment of Transmission License") drifted to Order, and -- after
  // lib/ingest.ts's no-text rule made the "Hearings / Cause List" hint count --
  // to Daily Order instead, because nothing said which section each type lives
  // in. Measured on the 5 real regressions, 2 runs each: prompt rule alone
  // fixed 3 of 5; with these two sentences, 5 of 5 (plus a sixth hearing row),
  // all still flagged, no control's Instrument Type moved.
  {
    name: "Hearing Notice",
    shortCode: "HN",
    definition:
      "A formal NOTICE issued by the Commission to the named Petitioner(s) and Respondent(s) in a numbered case, communicating the date and mode of a scheduled e-Hearing and the procedural directions for attending it -- including its rescheduling variants (Postponed Notice, Preponed Notice, Combined Notice) and live-streaming link notices. Distinct from Public Notice / Consultation Notice, which invites the general public to comment on a draft instrument; a Hearing Notice invites nobody to comment and directs named parties to appear. MERC publishes these in its Hearings / Cause List section and titles each one with the matter being heard, so a Hearings / Cause List document titled 'Petition of X seeking ...' is the Hearing Notice FOR that petition -- not the petition, not an Order, and not a Daily Order.",
  },
  {
    name: "Daily Order",
    shortCode: "DO",
    definition:
      "A coram-signed order of the Commission recording the proceedings of a hearing and any interim directions issued at it, in a case that remains pending. Distinct from Order, which disposes of the petition. Includes the real Draft Daily Order variant MERC publishes ahead of finalisation. MERC publishes these in a separate Daily Orders section; a document from the Hearings / Cause List section is not a Daily Order unless its own title or text says it is one.",
  },
  {
    name: "Report",
    shortCode: "RPT",
    definition:
      "A substantive report or periodic compliance-data publication other than the Annual Report -- sector reports on distribution, transmission and generation, consultant studies, and the quarterly Standards of Performance compliance data licensees file with the Commission.",
  },
  {
    name: "Licence",
    shortCode: "LICN",
    definition:
      "A transmission, distribution or trading licence granted by the Commission to a named entity, as a document in its own right -- distinct from the Order that grants it.",
  },
  {
    name: "Tender / RFP",
    shortCode: "TND",
    definition:
      "A procurement tender, request for proposal, auction notice, or corrigendum to one, issued by MERC for its own administrative needs.",
  },
  {
    name: "Notification",
    shortCode: "NOTF",
    definition:
      "An administrative notification constituting, reconstituting, or superseding a committee or body, and State/Central Government notifications MERC republishes -- distinct from Regulations (subordinate legislation) and from Order (a case decision).",
  },
  {
    name: "Minutes of Meeting",
    shortCode: "MOM",
    definition: "The minutes of a State Advisory Committee or M-DNAC meeting.",
  },
  {
    name: "Recruitment Notice",
    shortCode: "RECR",
    definition:
      "A vacancy advertisement, empanelment notice, or recruitment result published by the Commission for its own staffing.",
  },
];

const STATUS_TAGS: Array<{ name: string; shortCode: string; definition: string }> = [
  {
    name: "In Force",
    shortCode: "INF",
    definition:
      "The instrument is currently operative and unrevoked/unstayed -- a currently valid Regulation, a final Order not under appeal, or a Daily Order whose interim directions bind the parties until the final Order is issued.",
  },
  {
    name: "Draft / Under Consultation",
    shortCode: "DFT",
    definition:
      "The instrument is genuinely unfinalised and pending -- reserved for real Draft Orders and draft Regulations put out for consultation, not for press releases or outreach content.",
  },
  {
    name: "Superseded",
    shortCode: "SUP",
    definition: "The instrument has been fully replaced by a later version.",
  },
  {
    name: "Amended",
    shortCode: "AMD",
    definition:
      "The instrument's terms have been revised without a full replacement -- distinct from a Corrigendum Order, which corrects a specific final Order rather than amending an ongoing Regulation.",
  },
  {
    name: "Repealed",
    shortCode: "REP",
    definition: "The instrument has been withdrawn without a direct replacement.",
  },
  {
    name: "Under Litigation / Stayed",
    shortCode: "STAY",
    definition:
      "THIS instrument is under appeal to the Appellate Tribunal for Electricity (APTEL/ATE) or a higher court, or has itself been stayed by a granted stay order. Not triggered by a document that merely narrates litigation concerning some other instrument, and not by a stay that has only been applied for.",
  },
  {
    name: "Not Applicable",
    shortCode: "NA",
    definition:
      "The Status facet does not meaningfully describe this content -- press releases, FAQs, recruitment notices, minutes, RTI replies, and procedural case-management communications such as Hearing Notices, which are spent one-time communications about a calendar event rather than instruments with a legal lifecycle.",
  },
];

async function main() {
  console.log("Seeding MERC taxonomy...");

  const domain = await prisma.domain.upsert({
    where: { name: "Electricity" },
    update: {},
    create: {
      name: "Electricity",
      description:
        "Electricity sector regulation in India -- central and state electricity regulatory commissions and the appellate tribunal above them.",
    },
  });
  console.log(`Domain "Electricity" ready (id: ${domain.id})`);

  const regulator = await prisma.regulator.upsert({
    where: { code: "MERC" },
    update: { domainId: domain.id },
    create: {
      code: "MERC",
      name: "Maharashtra Electricity Regulatory Commission",
      domainId: domain.id,
      websiteUrl: "https://merc.gov.in",
    },
  });
  console.log(`Regulator "MERC" ready (id: ${regulator.id})`);

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

  console.log("MERC taxonomy seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
