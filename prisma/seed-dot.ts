/**
 * Seed script: DoT (Department of Telecommunications) taxonomy.
 *
 * Creates/updates (idempotently, via upsert — safe to re-run):
 *   1. The "Telecom" Domain, if it doesn't already exist.
 *   2. The "DOT" Regulator under that Domain.
 *   3. Every TaxonomyTag row for DoT's SUBJECT and INSTRUMENT_TYPE facets,
 *      built bottom-up from real scraped titles (see the pressure-test
 *      conversation this taxonomy came from — every "Confirmed" tag below
 *      has real title evidence behind it, every "Placeholder" tag is a
 *      real DoT function per its own org chart but not yet evidenced in
 *      the sample we pressure-tested against).
 *
 * IMPORTANT: this imports the shared Prisma client singleton from
 * lib/prisma.ts (the one wired up in Stage 1, matching Case Console's
 * PrismaPg-adapter pattern) rather than instantiating a new PrismaClient
 * here — do not create a second client instance.
 *
 * ADJUST THE IMPORT PATH BELOW if this file doesn't sit where lib/prisma.ts
 * expects it (e.g. if you place this at prisma/seed-dot.ts vs
 * scripts/seed-dot.ts the relative path differs) — verify with Claude Code
 * if `npx tsx seed-dot.ts` (or however you choose to run it) can't resolve
 * the import.
 *
 * Run with (adjust to whatever TS runner this project uses, e.g. tsx):
 *   npx tsx prisma/seed-dot.ts
 */

import "dotenv/config"; // required when run standalone via tsx — lib/prisma.ts
                          // reads process.env.DATABASE_URL directly and, unlike
                          // the Next.js app itself, a bare script has nothing
                          // else loading .env (confirmed: DATABASE_URL was
                          // undefined without this, causing an ECONNREFUSED
                          // against a Prisma adapter given an undefined
                          // connection string, not a real DB issue)
import { prisma } from "../lib/prisma"; // ADJUST PATH if needed — see note above
import { seedStandardStatusTags } from "./seed-shared";

// ---------------------------------------------------------------------------
// SUBJECT taxonomy — built bottom-up from real DoT titles (see pressure-test).
// Each entry: [name, shortCode, definition, parentName | null, status, notes]
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
    name: "Licensing",
    shortCode: "LIC",
    definition:
      "License and authorisation matters for telecom service providers — the single highest-volume real Subject category found in pressure-testing.",
    parentName: null,
    status: "ACTIVE",
    notes:
      "Confirmed dominant category: 20+ of 42 substantive real titles were licensing-related (Unified License, VSAT/Satellite, Access Service licenses).",
  },
  {
    name: "Licensing > Unified License / Access Services",
    shortCode: "LIC-UL",
    definition:
      "Unified License framework and Access Service License matters specifically (as distinct from VSAT/Satellite licensing).",
    parentName: "Licensing",
    status: "ACTIVE",
    notes: "Real evidence: 'List of UL Licences', 'Amendment to Unified License...', 'List of Access Service Licences Issued', etc.",
  },
  {
    name: "Licensing > VSAT / Satellite Communication",
    shortCode: "LIC-VSAT",
    definition: "VSAT, Satellite Communication Network, and INSAT MSSR license matters.",
    parentName: "Licensing",
    status: "ACTIVE",
    notes: "Real evidence: 'Commercial VSAT License Agreement', 'Guidelines for establishing Satellite-based Communication Networks', etc.",
  },
  {
    name: "Spectrum Management",
    shortCode: "SPEC",
    definition:
      "Spectrum allotment, assignment, auction, harmonization, and associated fees. Includes spectrum auction and fee matters — corrected during pressure-testing from an earlier draft that had wrongly filed these under Standardization and R&D.",
    parentName: null,
    status: "ACTIVE",
    notes: "Real evidence: PMRTS spectrum fee circular + its corrigendum, '3G & BWA Spectrum Auction', 'Draft Telecommunications (Spectrum Assignment by Administrative Process) Rules'.",
  },
  {
    name: "Universal Service Obligation Fund",
    shortCode: "USOF",
    definition: "Rural/underserved connectivity funding, BharatNet and related USOF-administered programs.",
    parentName: null,
    status: "UNDER_REVIEW",
    notes: "PLACEHOLDER — a real DoT function per its own org chart, but not yet evidenced in the pressure-tested sample. Confirm or drop once Reports/Publications are sampled.",
  },
  {
    name: "Network Security / Content Compliance",
    shortCode: "NSCC",
    definition:
      "ISP content-blocking directives under court orders, network security compliance matters. Renamed during pressure-testing from a vaguer draft label ('Enforcement') to match what real documents actually are.",
    parentName: null,
    status: "ACTIVE",
    notes: "Real evidence: recurring 'Blocking Notifications/instructions to Internet Service Licensees under court orders' entries (multiple quarters).",
  },
  {
    name: "Foreign Direct Investment",
    shortCode: "FDI",
    definition: "FDI matters specific to the telecom sector.",
    parentName: null,
    status: "UNDER_REVIEW",
    notes: "PLACEHOLDER — not yet evidenced in the pressure-tested sample.",
  },
  {
    name: "International Cooperation",
    shortCode: "INTL",
    definition: "ITU, APT, and other international treaty/coordination matters.",
    parentName: null,
    status: "UNDER_REVIEW",
    notes: "PLACEHOLDER — not yet evidenced in the pressure-tested sample.",
  },
  {
    name: "Standardization and R&D",
    shortCode: "RD",
    definition: "Technical standards, testing, and telecom-sector R&D promotion.",
    parentName: null,
    status: "UNDER_REVIEW",
    notes: "PLACEHOLDER — not yet evidenced in the pressure-tested sample. NOTE: does NOT include spectrum auctions (see Spectrum Management correction above).",
  },
  {
    name: "PSU Matters",
    shortCode: "PSU",
    definition: "BSNL, MTNL, ITI, TCIL oversight matters.",
    parentName: null,
    status: "UNDER_REVIEW",
    notes: "PLACEHOLDER — not yet evidenced in the pressure-tested sample.",
  },
  {
    name: "Government Connectivity Projects",
    shortCode: "GCP",
    definition: "BharatNet, 4G Saturation, LWE/NER/Islands connectivity projects (may fold into USOF pending more evidence).",
    parentName: null,
    status: "UNDER_REVIEW",
    notes: "PLACEHOLDER — not yet evidenced. Open question: should this fold into Universal Service Obligation Fund instead of standing alone? Revisit once evidenced.",
  },
  {
    name: "Governance and Rulemaking",
    shortCode: "GOV",
    definition: "DoT's own internal/administrative matters not tied to a specific regulated sector.",
    parentName: null,
    status: "ACTIVE",
    notes: "Real evidence: Nodal Officer nomination under Telecommunications Act 2023 s.14(4), Telecommunications Engineering Service recruitment-rules amendment.",
  },
  {
    name: "Governance and Rulemaking > Personnel/Administration",
    shortCode: "GOV-PA",
    definition: "Staff transfers, postings, promotions, retirements — routine HR/administrative notices.",
    parentName: "Governance and Rulemaking",
    status: "ACTIVE",
    notes:
      "DELIBERATE PRODUCT DECISION: ~89% (325/367) of DoT's 'Orders and Notices' section is this category. Decision: ingest everything (don't filter at scrape time), tag here, but DEFAULT-HIDE this category in the wiki UI so it doesn't dominate the browsing experience. Do not silently drop these documents — they should remain queryable, just not front-and-center.",
  },
];

// ---------------------------------------------------------------------------
// INSTRUMENT TYPE taxonomy — built from real title patterns in the same sample.
// ---------------------------------------------------------------------------
const INSTRUMENT_TYPE_TAGS: Array<{ name: string; shortCode: string; definition: string }> = [
  { name: "Order", shortCode: "ORD", definition: "A directive order, e.g. transfer/posting orders, blocking-notification orders." },
  { name: "Notice", shortCode: "NOT", definition: "A general notice." },
  { name: "Rules", shortCode: "RUL", definition: "Rules notified under the Telecommunications Act 2023 or its predecessor framework, e.g. '...Rules, 2026'." },
  { name: "Act", shortCode: "ACT", definition: "The Telecommunications Act itself or amendments to it." },
  { name: "Corrigendum", shortCode: "COR", definition: "A correction notice to a previously issued document (e.g. the PMRTS spectrum fee corrigendum)." },
  { name: "Report", shortCode: "REP", definition: "A DoT report (from the Reports section)." },
  { name: "Publication", shortCode: "PUB", definition: "A DoT publication." },
  { name: "Press Release", shortCode: "PR", definition: "A press release." },
  { name: "Gazette Notification", shortCode: "GAZ", definition: "A notification published in the Official Gazette." },
  { name: "Guidelines", shortCode: "GDL", definition: "Guidelines issued by DoT (e.g. 'Guidelines for Access Services Licences')." },
  { name: "Office Memorandum", shortCode: "OM", definition: "An internal administrative or procedural communication issued by DoT, as distinct from a public Notice or Order." },
];

async function main() {
  console.log("Seeding DoT taxonomy...");

  const domain = await prisma.domain.upsert({
    where: { name: "Telecom" },
    update: {},
    create: { name: "Telecom", description: "Telecommunications sector regulators." },
  });
  console.log(`Domain "Telecom" ready (id: ${domain.id})`);

  const regulator = await prisma.regulator.upsert({
    where: { code: "DOT" },
    update: { domainId: domain.id },
    create: {
      code: "DOT",
      name: "Department of Telecommunications",
      domainId: domain.id,
      websiteUrl: "https://www.dot.gov.in",
    },
  });
  console.log(`Regulator "DOT" ready (id: ${regulator.id})`);

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

  // Instrument Type tags — all flat, no hierarchy for DoT currently.
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

  await seedStandardStatusTags(regulator.id, "DOT");

  console.log("DoT taxonomy seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
