/**
 * Seed script: CCI (Competition Commission of India) taxonomy.
 *
 * Creates/updates (idempotently, via upsert -- safe to re-run):
 *   1. The "Competition Law" Domain (new).
 *   2. The "CCI" Regulator under that Domain.
 *   3. Every TaxonomyTag row for SUBJECT (13), INSTRUMENT_TYPE (12), and
 *      STATUS (7).
 *
 * Subject/Instrument Type definitions and their 6 base Status definitions
 * are copied verbatim from CCI_Regulatory_Taxonomy_v1_1.xlsx's Taxonomy
 * sheet (~/Downloads/CCI_Regulatory_Taxonomy_v1_1.xlsx).
 *
 * "Not Applicable" is the one Status value NOT in that physical workbook --
 * scrapers/cci_scraper/cci_scraper/__init__.py added it at v1_3 (code-only,
 * workbook never regenerated to match) to give real outreach/advocacy
 * content (e.g. "Call for Papers") somewhere to land instead of being
 * force-fit into "In Force". The stratified pressure-test run
 * (taxonomy-findings-v2.md, 2026-08-19) found the rule AS WRITTEN was
 * badly over-applied: 52/303 real documents got "Not Applicable", of which
 * only 1 was actually correct -- 23 tenders/procurement notices with a
 * real operative deadline/award were wrongly tagged (a confirmed bug: the
 * model's own rationale said "operative consequence" and then picked "Not
 * Applicable" anyway), and 27 Market Study documents got reclassified out
 * of the prior run's "In Force" treatment as an unintended side effect,
 * not a deliberate decision. The definition below encodes the findings
 * doc's own proposed fix directly, rather than the broad wording that
 * caused the bug: explicitly excludes tenders/procurement (should be In
 * Force) and defaults Market Studies to In Force too (a published study is
 * its own current standing version) -- consistent with lib/ingest.ts's
 * existing generic Status rule that non-instrument content defaults to the
 * operative state unless there's a specific reason otherwise. This
 * regulator uses the wiki's own classification pipeline (lib/ingest.ts),
 * not CCI's standalone Python classifier.py that produced that finding, so
 * this fixed definition is the only place that bug could otherwise
 * re-enter here.
 *
 * STATUS is a flat, unscoped vocabulary (statusAppliesToSubjectIds: [] for
 * every value) -- same pattern as prisma/seed-dos-isro.ts.
 *
 * Mirrors prisma/seed-dos-isro.ts's structure and conventions.
 *
 * Run with:
 *   npx tsx prisma/seed-cci.ts
 */

import "dotenv/config";
import { prisma } from "../lib/prisma";

const SUBJECT_TAGS: Array<{ name: string; shortCode: string; definition: string }> = [
  {
    name: "Anti-competitive Agreements & Cartel Enforcement",
    shortCode: "ANTICOMP",
    definition:
      "Enforcement of Section 3 of the Competition Act: cartels, bid rigging, horizontal/vertical restraints, resale price maintenance, and leniency/lesser-penalty matters.",
  },
  {
    name: "Abuse of Dominant Position",
    shortCode: "ABUSE",
    definition:
      "Enforcement of Section 4 of the Competition Act: abuse of dominance, predatory pricing, denial of market access, discriminatory conduct by a dominant enterprise.",
  },
  {
    name: "Combination Review & Approval",
    shortCode: "COMBREV",
    definition:
      "Substantive assessment of mergers/acquisitions ('combinations') under Sections 5-6, including approvals, modification-based approvals, and Green Channel automatic approvals.",
  },
  {
    name: "Combination Filing & Procedure",
    shortCode: "COMBFILE",
    definition:
      "Pre-notification and filing procedure for combinations: forms, filing guidance, pre-filing consultations, and the Green Channel automatic-approval route.",
  },
  {
    name: "Combination Compliance & Enforcement",
    shortCode: "COMBENF",
    definition:
      "Enforcement of combination notification/disclosure obligations, including Section 43A (failure to notify) and Section 44 (false information/gun-jumping) matters.",
  },
  {
    name: "Competition Law Framework",
    shortCode: "LAWFW",
    definition:
      "The Competition Act and cross-cutting Regulations/Notifications governing the competition-law system as a whole, rather than one substantive regime.",
  },
  {
    name: "Rulemaking & Public Consultation",
    shortCode: "RULEMK",
    definition:
      "Cross-cutting development, amendment, or public consultation on competition-law rules, regulations, or CCI's institutional powers.",
  },
  {
    name: "Market Studies & Economic Research",
    shortCode: "MKTSTUDY",
    definition:
      "Sectoral or empirical market studies and economic research conducted or commissioned by CCI to understand competitive conditions in specific sectors.",
  },
  {
    name: "Competition Advocacy & Outreach",
    shortCode: "ADVOCACY",
    definition:
      "Awareness, training, and stakeholder engagement activity: workshops, conferences, compliance toolkits, moot court engagement, guest lectures.",
  },
  {
    name: "International Cooperation",
    shortCode: "INTL",
    definition:
      "CCI's bilateral and multilateral cooperation with foreign competition authorities and international bodies.",
  },
  {
    name: "Institutional Governance & Administration",
    shortCode: "GOV",
    definition:
      "CCI's own internal governance, ethics, and administrative directives not tied to a specific enforcement or advocacy function.",
  },
  {
    name: "Recruitment, Procurement & Institutional Opportunities",
    shortCode: "PROC",
    definition:
      "Job vacancies, deputation postings, internship calls, tenders, RFPs, and empanelment notices issued by CCI.",
  },
  {
    name: "Public Information & Transparency",
    shortCode: "RTI",
    definition: "RTI disclosures and public-transparency material published under the Right to Information Act.",
  },
];

const INSTRUMENT_TYPE_TAGS: Array<{ name: string; shortCode: string; definition: string }> = [
  { name: "Act", shortCode: "ACT", definition: "The Competition Act, 2002 itself." },
  {
    name: "Regulation",
    shortCode: "REG",
    definition: "A CCI-notified Regulation, whether final or in draft form for consultation.",
  },
  { name: "Notification", shortCode: "NOT", definition: "A formal Gazette or CCI notification." },
  {
    name: "CCI Order",
    shortCode: "ORDER",
    definition: "An adjudicatory order passed by the Commission, e.g. under Section 26(1)/26(2)/27/31/43A/44.",
  },
  {
    name: "Public Notice / Consultation Notice",
    shortCode: "PNOTICE",
    definition:
      "A notice inviting public/stakeholder comments, or announcing an extended comment period, on a draft regulation or a specific case (e.g. a commitment offer).",
  },
  {
    name: "Press Release",
    shortCode: "PR",
    definition: "A public press release, typically announcing a combination approval or enforcement action.",
  },
  { name: "Tender / RFP", shortCode: "TND", definition: "A procurement tender or Request for Proposal issued by CCI." },
  {
    name: "Recruitment / Empanelment Notice",
    shortCode: "RECRUIT",
    definition: "A job vacancy, deputation posting, or professional empanelment notice (e.g. for advocates or law firms).",
  },
  { name: "Annual Report", shortCode: "AR", definition: "CCI's statutory Annual Report to Parliament." },
  {
    name: "Market Study / Research Report",
    shortCode: "MSTUDY",
    definition: "A published market study or economic research report.",
  },
  { name: "FAQ", shortCode: "FAQ", definition: "A Frequently Asked Questions document, typically supporting a filing or procedural function." },
  {
    name: "Award of Work / Institutional Notice",
    shortCode: "AWARD",
    definition:
      "A notice disclosing the award of a specific institutional contract or engagement, typically issued for procurement-transparency/vigilance compliance.",
  },
];

const STATUS_TAGS: Array<{ name: string; shortCode: string; definition: string }> = [
  { name: "In Force", shortCode: "INF", definition: "The instrument is the current, legally operative version." },
  {
    name: "Draft / Under Consultation",
    shortCode: "DFT",
    definition: "Published for stakeholder comment, not yet finalised or notified.",
  },
  {
    name: "Superseded",
    shortCode: "SUP",
    definition: "A later version of the same Regulation/Notification has replaced this one.",
  },
  {
    name: "Amended",
    shortCode: "AMD",
    definition: "The base instrument remains in force but has been modified by a subsequent amendment regulation or notification.",
  },
  {
    name: "Repealed",
    shortCode: "REP",
    definition: "The instrument has been formally withdrawn, generally without a direct like-for-like successor.",
  },
  {
    name: "Under Litigation / Stayed",
    shortCode: "LIT",
    definition:
      "The instrument or a specific CCI Order's validity is subject to an ongoing appeal before NCLAT or the Supreme Court, or has been stayed.",
  },
  {
    name: "Not Applicable",
    shortCode: "NA",
    definition:
      "Reserved for outreach, advocacy, or event-driven content with no operative deadline, award, or administrative consequence of its own -- a Call for Papers, conference announcement, or training/workshop notice. Does NOT apply to tenders, RFPs, contract awards, or tender cancellations -- these carry a real deadline or consequence and should be In Force. Does NOT apply to Market Study / Research Report content either -- a published study is its own current, standing version and should be In Force.",
  },
];

async function main() {
  console.log("Seeding CCI taxonomy...");

  const domain = await prisma.domain.upsert({
    where: { name: "Competition Law" },
    update: {},
    create: {
      name: "Competition Law",
      description: "India's competition/antitrust regulatory regime, administered by the Competition Commission of India.",
    },
  });
  console.log(`Domain "Competition Law" ready (id: ${domain.id})`);

  const regulator = await prisma.regulator.upsert({
    where: { code: "CCI" },
    update: { domainId: domain.id },
    create: {
      code: "CCI",
      name: "Competition Commission of India",
      domainId: domain.id,
      websiteUrl: "https://www.cci.gov.in",
    },
  });
  console.log(`Regulator "CCI" ready (id: ${regulator.id})`);

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
        versionAdded: "v1.0",
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
        versionAdded: "v1.0",
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
        versionAdded: tag.name === "Not Applicable" ? "v1.3" : "v1.0",
        statusAppliesToSubjectIds: [],
      },
    });
    console.log(`  Status: ${tag.name}`);
  }

  console.log("CCI taxonomy seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
