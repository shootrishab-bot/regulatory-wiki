/**
 * Seed script: DOS-ISRO Ecosystem taxonomy (ISRO / IN-SPACe / DOS / NSIL).
 *
 * Creates/updates (idempotently, via upsert -- safe to re-run):
 *   1. The "Space" Domain (new).
 *   2. The "DOS-ISRO" Regulator under that Domain.
 *   3. Every TaxonomyTag row for SUBJECT (12), INSTRUMENT_TYPE (11), and
 *      STATUS (6) -- sourced directly from
 *      DOS_ISRO_Regulatory_Taxonomy_v1_0.xlsx's Taxonomy sheet.
 *
 * STATUS here is a flat, unscoped vocabulary (statusAppliesToSubjectIds: []
 * for every value) -- unlike DST's hybrid vocabulary, this taxonomy's own
 * Schema Note says nothing about per-Subject Status scoping, and its Status
 * definitions read as generic instrument-lifecycle values applicable across
 * every Subject. Does NOT use seed-shared.ts's seedStandardStatusTags(),
 * since that helper's generic 4-value vocabulary merges Superseded/Repealed
 * into one tag and has no Not Applicable value -- this taxonomy's real
 * workbook explicitly keeps Superseded and Repealed as two separate values
 * and includes Not Applicable deliberately from v1.0 (the taxonomy's own
 * Schema Note: adopted directly from CCI's v1.3 correction, to avoid
 * repeating that same two-version detour here).
 *
 * Mirrors prisma/seed-dst.ts's structure and conventions.
 *
 * Run with:
 *   npx tsx prisma/seed-dos-isro.ts
 */

import "dotenv/config";
import { prisma } from "../lib/prisma";

const SUBJECT_TAGS: Array<{ name: string; shortCode: string; definition: string }> = [
  {
    name: "Space Activity Authorization & Licensing",
    shortCode: "AUTH",
    definition: "The core IN-SPACe regulatory function: authorizing Non-Government Entities (NGEs) and government entities to establish/operate space objects, launch vehicles, ground systems, and related services, per the Indian Space Policy 2023 and the NGP.",
  },
  {
    name: "Remote Sensing Data Policy & Licensing",
    shortCode: "RSDP",
    definition: "Licensing and policy governing acquisition, dissemination, and resolution thresholds for satellite remote sensing data -- historically DOS/NRSC's own licensing regime, now folded into IN-SPACe authorization for NGE dissemination.",
  },
  {
    name: "Satellite Communication (Spacecom) Policy & Authorization",
    shortCode: "SPACOM",
    definition: "Policy and authorization framework for commercial use of orbital slots, satellites, and ground stations for communication services -- includes the 1997 Satellite Communication Policy and its successors.",
  },
  {
    name: "Space Sector Foreign Direct Investment (FDI)",
    shortCode: "FDI",
    definition: "FDI thresholds and approval routes specific to the space sector, administered jointly with the Ministry of Commerce and Industry.",
  },
  {
    name: "Space Sector Policy Framework",
    shortCode: "POLFW",
    definition: "Overarching national policy instruments defining the space sector's structure and the roles of ISRO, IN-SPACe, NSIL, and DOS -- distinct from sector-specific policies (remote sensing, spacecom) above.",
  },
  {
    name: "Commercial Launch Services & Contracts",
    shortCode: "LAUNCH",
    definition: "NSIL's commercial launch-service and satellite-manufacturing contracts with Indian and foreign customers -- a real business/commercial-law layer, not a rulemaking one.",
  },
  {
    name: "Technology Transfer & Industry Consortium",
    shortCode: "TECHXFER",
    definition: "Licensing of ISRO/DOS technology to Indian industry, and consortium-route production arrangements (e.g. PSLV, SSLV manufacturing through industry).",
  },
  {
    name: "Procurement & Tenders",
    shortCode: "PROC",
    definition: "Tenders, RFPs, and corrigenda issued by ISRO Centres and NSIL for goods, works, and services -- administrative/commercial, not rulemaking, structurally the same role as CCI's Tenders feed.",
  },
  {
    name: "International Cooperation",
    shortCode: "INTL",
    definition: "MoUs, joint working groups, and cooperation agreements with foreign space agencies and international bodies.",
  },
  {
    name: "Institutional Governance & Administration",
    shortCode: "GOV",
    definition: "Internal governance of ISRO/DOS/IN-SPACe/NSIL -- Space Commission composition, leadership appointments, organisational restructuring.",
  },
  {
    name: "Public Information & Transparency",
    shortCode: "RTI",
    definition: "RTI disclosures and related transparency obligations across ISRO/DOS/IN-SPACe/NSIL.",
  },
  {
    name: "Space Outreach & Education",
    shortCode: "OUTREACH",
    definition: "Public engagement, education programmes, and conference/outreach content -- not regulatory in substance. Exists as a Subject specifically so this content has somewhere real to land rather than being force-fit into a regulatory Subject, mirroring CCI's Competition Advocacy & Outreach.",
  },
];

const INSTRUMENT_TYPE_TAGS: Array<{ name: string; shortCode: string; definition: string }> = [
  { name: "Act / Bill", shortCode: "ACT", definition: "The Space Activities Bill (draft, lapsed 2019) and any future primary legislation for the space sector." },
  { name: "Policy", shortCode: "POL", definition: "A Cabinet- or DOS-level policy document setting sector-wide or domain-specific rules (Indian Space Policy 2023, Remote Sensing Data Policy, Spacecom Policy)." },
  { name: "Norms, Guidelines and Procedures (NGP)", shortCode: "NGP", definition: "IN-SPACe's operative rulebook implementing a Policy -- distinct from Policy itself, since NGPs are the detailed authorization criteria, timelines, and procedures, not the top-level policy statement." },
  { name: "Authorization", shortCode: "AUTH", definition: "An individual grant of authorization by IN-SPACe to a named entity for a specific space activity -- the actual operative output of the licensing process, analogous to a CCI Order." },
  { name: "Notification / Circular", shortCode: "NOT", definition: "Administrative notifications and circulars that do not themselves promulgate a Policy, NGP, or Authorization -- corrigenda, procedural updates, individual exemption notices." },
  { name: "Tender / RFP", shortCode: "TND", definition: "A procurement tender, request for proposal, or corrigendum issued by ISRO Centres or NSIL." },
  { name: "Contract / Agreement", shortCode: "CTR", definition: "A signed commercial contract or MoU -- launch-service contracts, technology-transfer agreements, international cooperation MoUs." },
  { name: "Annual Report", shortCode: "AR", definition: "The annual report of ISRO, DOS, IN-SPACe, or NSIL." },
  { name: "Press Release", shortCode: "PR", definition: "A press release announcing a mission milestone, cooperation agreement, or organisational event -- the largest expected volume category, same role as CCI's Press Release." },
  { name: "FAQ", shortCode: "FAQ", definition: "Static frequently-asked-questions content." },
  { name: "RTI Response / Disclosure", shortCode: "RTID", definition: "Suo-motu disclosures and RTI-related content published under the RTI Corner." },
];

const STATUS_TAGS: Array<{ name: string; shortCode: string; definition: string }> = [
  { name: "In Force", shortCode: "INF", definition: "The instrument is currently operative -- a Policy, NGP, or Authorization that is presently valid and unrevoked." },
  { name: "Draft / Under Consultation", shortCode: "DFT", definition: "The instrument is genuinely unfinalised and pending -- reserved for real instruments awaiting approval, not for outreach/event content." },
  { name: "Superseded", shortCode: "SUP", definition: "The instrument has been fully replaced by a later version -- e.g. the 2001 RSDP superseded by the 2011 RSDP, itself effectively superseded by the 2016 National Geospatial Policy." },
  { name: "Amended", shortCode: "AMD", definition: "The instrument's terms have been revised without a full replacement." },
  { name: "Repealed", shortCode: "REP", definition: "The instrument has been withdrawn without a direct replacement." },
  { name: "Not Applicable", shortCode: "NA", definition: "The Status facet does not meaningfully describe this content -- outreach, education, and event content that is not itself a regulatory instrument with a lifecycle." },
];

async function main() {
  console.log("Seeding DOS-ISRO taxonomy...");

  const domain = await prisma.domain.upsert({
    where: { name: "Space" },
    update: {},
    create: {
      name: "Space",
      description: "India's space sector regulatory ecosystem: ISRO, IN-SPACe, the Department of Space, and NSIL.",
    },
  });
  console.log(`Domain "Space" ready (id: ${domain.id})`);

  const regulator = await prisma.regulator.upsert({
    where: { code: "DOS-ISRO" },
    update: { domainId: domain.id },
    create: {
      code: "DOS-ISRO",
      name: "Department of Space / ISRO / IN-SPACe / NSIL",
      domainId: domain.id,
      websiteUrl: "https://www.isro.gov.in",
    },
  });
  console.log(`Regulator "DOS-ISRO" ready (id: ${regulator.id})`);

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
        versionAdded: "v1.0",
        statusAppliesToSubjectIds: [], // flat vocabulary, applies to every Subject -- see module docstring
      },
    });
    console.log(`  Status: ${tag.name}`);
  }

  console.log("DOS-ISRO taxonomy seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
