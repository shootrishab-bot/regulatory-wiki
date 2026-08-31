/**
 * Seed script: Employment Law domain taxonomy (EPFO, ESIC, CLC).
 *
 * Creates/updates (idempotently, via upsert -- safe to re-run):
 *   1. The "Employment Law" Domain, if it doesn't already exist.
 *   2. The EPFO, ESIC, and CLC Regulators under that Domain.
 *   3. Every TaxonomyTag row for each regulator's SUBJECT and
 *      INSTRUMENT_TYPE facets, built bottom-up from a real live pressure-test
 *      scrape (2026-08-13, 805 real documents: EPFO 455, ESIC 300, CLC 50).
 *      See EmploymentLaw_Regulatory_Taxonomy_v1.0.xlsx for the full evidence
 *      trail -- every tag below has real title evidence behind it except
 *      where a Notes/Evidence-equivalent comment says otherwise (mirrors
 *      seed-dot.ts's convention, minus the Notes column here -- kept in the
 *      workbook instead since this file has no `notes` field populated for
 *      most tags, unlike DoT's seed script).
 *
 *   MoLE is deliberately NOT seeded here: both its real sources
 *   (master-labour.digifootprint.gov.in mirror, labour.gov.in production
 *   site) are confirmed non-functional/blocked as of 2026-08-13, so there is
 *   zero real document evidence to build a taxonomy from -- see the
 *   workbook's Schema Note sheet ("MoLE excluded from this version").
 *
 * Mirrors prisma/seed-dot.ts's structure and conventions exactly.
 *
 * Run with:
 *   npx tsx prisma/seed-employment-law.ts
 */

import "dotenv/config"; // required when run standalone via tsx -- see seed-dot.ts's
                          // note on why (lib/prisma.ts reads DATABASE_URL directly)
import { prisma } from "../lib/prisma";
import { seedStandardStatusTags } from "./seed-shared";

type SubjectTag = {
  name: string;
  shortCode: string;
  definition: string;
  parentName: string | null;
  status: "ACTIVE" | "UNDER_REVIEW";
  notes?: string;
};

type InstrumentTag = { name: string; shortCode: string; definition: string; notes?: string };

// ---------------------------------------------------------------------------
// EPFO
// ---------------------------------------------------------------------------
const EPFO_SUBJECT_TAGS: SubjectTag[] = [
  {
    name: "Provident Fund Interest & Member Accounts",
    shortCode: "PFI",
    definition: "Declaration/crediting of PF interest rates, member account matters.",
    parentName: null,
    status: "ACTIVE",
    notes:
      "CONFIRMED. E.g. 'Declaration of Rate of Interest for the Employees' Provident Fund Members Account for the year 2025-26'.",
  },
  {
    name: "Enforcement, Exemption & Recovery",
    shortCode: "ENF",
    definition:
      "Damages/recovery under the Code on Social Security 2020, exemption status of PF Trusts, and amnesty/settlement schemes for these disputes.",
    parentName: null,
    status: "ACTIVE",
    notes:
      "CONFIRMED. E.g. Authorised Officers notification under Code on Social Security Ch. III, 'AMNESTY, 2026', 'VISHWAS, 2026'.",
  },
  {
    name: "International Social Security Agreements",
    shortCode: "ISSA",
    definition: "Bilateral social security / totalization agreements between India and other countries.",
    parentName: null,
    status: "ACTIVE",
    notes: "CONFIRMED, real evidence: India-UK Social Security Contributions agreement.",
  },
  {
    name: "Member Services & Grievance Redressal",
    shortCode: "MSGR",
    definition: "Nidhi Aapke Nikat outreach camps and consumer/grievance case resolution drives.",
    parentName: null,
    status: "ACTIVE",
    notes: "CONFIRMED, high recurring volume: monthly Nidhi Aapke Nikat 2.0 camp venue notices.",
  },
  {
    name: "Internal Audit & Financial Administration",
    shortCode: "AUD",
    definition: "Internal audit planning/manuals, budget circulars, delegation of financial powers.",
    parentName: null,
    status: "ACTIVE",
    notes: "CONFIRMED. E.g. Internal Audit core areas, Audit Manual modifications, Budget Circulars.",
  },
  {
    name: "Governance and Administration",
    shortCode: "GOV",
    definition: "EPFO's own internal/administrative matters, not tied to a specific PF policy or member-facing function.",
    parentName: null,
    status: "ACTIVE",
    notes: "Parent tag for the three children below.",
  },
  {
    name: "Governance and Administration > Personnel/Establishment",
    shortCode: "GOV-PE",
    definition:
      "Staff transfers, postings, promotions, exam results, seniority lists, probation clearance, APAR -- routine internal HR/establishment notices.",
    parentName: "Governance and Administration",
    status: "ACTIVE",
    notes:
      "DELIBERATE PRODUCT DECISION: large real share of EPFO's Updates/Circulars feed. Ingest, tag, DEFAULT-HIDE in the wiki UI -- never silently drop.",
  },
  {
    name: "Governance and Administration > Empanelment & Procurement",
    shortCode: "GOV-EMP",
    definition: "Empanelment of advocates, chartered accountant firms, and audit firms; tender/bid invitations.",
    parentName: "Governance and Administration",
    status: "ACTIVE",
    notes:
      "CONFIRMED, very high real volume -- the single largest recurring pattern in the Updates feed. DEFAULT-HIDE, same reasoning as Personnel/Establishment.",
  },
  {
    name: "Governance and Administration > Official Language (Rajbhasha)",
    shortCode: "GOV-OL",
    definition: "Hindi-language promotion circulars: Hindi Diwas/Pakhwada, Hindi training programs, Rajbhasha committee matters.",
    parentName: "Governance and Administration",
    status: "ACTIVE",
    notes: "CONFIRMED, real recurring pattern. DEFAULT-HIDE.",
  },
];

const EPFO_INSTRUMENT_TYPE_TAGS: InstrumentTag[] = [
  { name: "Circular", shortCode: "CIR", definition: "A circular issued by EPFO Head Office or a Zonal/Regional Office." },
  { name: "Office Order", shortCode: "OO", definition: "An internal directive order (transfers, postings, charge assignments)." },
  { name: "Notification", shortCode: "NTF", definition: "A formal notification, e.g. of Authorised Officers under the Code on Social Security." },
  { name: "Notice", shortCode: "NOT", definition: "A general notice (exam declarations, results, extensions)." },
  { name: "Corrigendum", shortCode: "COR", definition: "A correction notice to a previously issued document." },
  { name: "Scheme", shortCode: "SCH", definition: "A named amnesty/settlement scheme, e.g. 'AMNESTY, 2026', 'VISHWAS, 2026'." },
  { name: "Agreement", shortCode: "AGR", definition: "A bilateral international social security agreement." },
  { name: "Rules", shortCode: "RUL", definition: "Draft or notified recruitment/service rules." },
  { name: "Advertisement", shortCode: "ADV", definition: "A public advertisement inviting applications, e.g. for advocate/CA-firm empanelment." },
];

// ---------------------------------------------------------------------------
// ESIC
// ---------------------------------------------------------------------------
const ESIC_SUBJECT_TAGS: SubjectTag[] = [
  {
    name: "Hospital & Medical Services Administration",
    shortCode: "HMSA",
    definition:
      "ESIC hospital/dispensary manpower norms, drug stock/expiry management, medical equipment specifications, nursing cadre duties, hospital SOPs, CGHS package rates.",
    parentName: null,
    status: "ACTIVE",
    notes: "CONFIRMED -- dominant real category.",
  },
  {
    name: "Insured Persons, Registration & Revenue Administration",
    shortCode: "IPRA",
    definition:
      "IP/employer registration systems, region-wise IP/employer statistics, revenue and contribution recovery targets, Code on Social Security 2020 outreach.",
    parentName: null,
    status: "ACTIVE",
    notes: "CONFIRMED. E.g. IP Registration in ERP, Annual Revenue Recovery target.",
  },
  {
    name: "Procurement & Rate Contracts",
    shortCode: "PRC",
    definition: "DGESIC rate contracts for pharmaceuticals/equipment, GeM bids, corrigenda/revisions, equipment standard specifications.",
    parentName: null,
    status: "ACTIVE",
    notes: "CONFIRMED, high real volume.",
  },
  {
    name: "Litigation Management & Legal Empanelment",
    shortCode: "LIT",
    definition: "National Litigation Committee matters, advocate empanelment standards and panel-advocate fees, court litigation policy.",
    parentName: null,
    status: "ACTIVE",
    notes: "CONFIRMED.",
  },
  {
    name: "Regulations & Rulemaking",
    shortCode: "REG",
    definition: "Formal ESI Act regulations -- the ESI Act's own instrument type (distinct from DoT/EPFO's 'Rules').",
    parentName: null,
    status: "ACTIVE",
    notes: "CONFIRMED, real evidence: Draft ESI (General) Regulations, 2026. Single real instance so far, same footing as DoT's 'Act' tag.",
  },
  {
    name: "Governance and Administration",
    shortCode: "GOV",
    definition: "ESIC's own internal/administrative matters, not tied to hospital operations, procurement, or a specific member-facing function.",
    parentName: null,
    status: "ACTIVE",
    notes: "Parent tag for the three children below.",
  },
  {
    name: "Governance and Administration > Personnel/Establishment",
    shortCode: "GOV-PE",
    definition:
      "Office orders (promotions, transfers, DPC), gradation/seniority lists, APAR completion, contract engagement notices, sports policy, holiday circulars.",
    parentName: "Governance and Administration",
    status: "ACTIVE",
    notes: "DELIBERATE PRODUCT DECISION: extremely high real volume. Ingest, tag, DEFAULT-HIDE.",
  },
  {
    name: "Governance and Administration > Official Language (Rajbhasha)",
    shortCode: "GOV-OL",
    definition: "Hindi-language promotion circulars, Rajbhasha committee minutes, Hindi implementation directives to field offices.",
    parentName: "Governance and Administration",
    status: "ACTIVE",
    notes: "CONFIRMED, real recurring pattern. DEFAULT-HIDE.",
  },
  {
    name: "Governance and Administration > IT Systems & Digital Infrastructure",
    shortCode: "GOV-IT",
    definition: "ERP rollouts, e-Office guidelines, web-based/portal-based monitoring systems for internal ESIC operations.",
    parentName: "Governance and Administration",
    status: "ACTIVE",
    notes: "CONFIRMED, real recurring pattern. NOT default-hidden -- reflects real digital-governance initiatives.",
  },
];

const ESIC_INSTRUMENT_TYPE_TAGS: InstrumentTag[] = [
  { name: "Office Order", shortCode: "OO", definition: "A sequentially-numbered internal directive order." },
  { name: "Office Memorandum", shortCode: "OM", definition: "A formal internal Office Memorandum (OM), distinct from a general Order or Notice." },
  { name: "Notice", shortCode: "NOT", definition: "A general notice." },
  { name: "Notification", shortCode: "NTF", definition: "A formal notification." },
  { name: "Corrigendum", shortCode: "COR", definition: "A correction notice to a previously issued document (frequently to rate contracts)." },
  { name: "Circular", shortCode: "CIR", definition: "A circular issued by ESIC Headquarters or a field office." },
  { name: "Order", shortCode: "ORD", definition: "A directive order not otherwise numbered as an Office Order." },
  { name: "Letter", shortCode: "LTR", definition: "A formal letter forwarding an advisory or instruction to field offices." },
  { name: "Guidelines", shortCode: "GDL", definition: "Standard guidelines, SOPs, or checklists issued by ESIC." },
  { name: "Regulations", shortCode: "RGN", definition: "A formal ESI Act Regulations instrument (draft or notified)." },
];

// ---------------------------------------------------------------------------
// CLC
// ---------------------------------------------------------------------------
const CLC_SUBJECT_TAGS: SubjectTag[] = [
  {
    name: "Minimum Wages & Variable Dearness Allowance (VDA)",
    shortCode: "MWVDA",
    definition: "VDA orders (semi-annual), Minimum Wages Act instructions/clarifications, and corrigenda to VDA orders.",
    parentName: null,
    status: "ACTIVE",
    notes: "CONFIRMED -- dominant real category. Recurring semi-annual VDA Order pattern back to 2015.",
  },
  {
    name: "Labour Codes & Acts Reference Library",
    shortCode: "ACTS",
    definition: "The foundational Acts and Rules texts CLC's site hosts as reference documents (not enforcement instructions about them).",
    parentName: null,
    status: "ACTIVE",
    notes: "CONFIRMED, real Acts and Rules section: Industrial Disputes Act, Contract Labour Act, BOCW Act, Minimum Wages Act, and others.",
  },
  {
    name: "Industrial Relations & Trade Union Matters",
    shortCode: "IR",
    definition: "Trade union verification, industrial disputes/Hours of Employment Regulation (HOER) instructions, standing-orders-related instructions.",
    parentName: null,
    status: "ACTIVE",
    notes: "CONFIRMED. E.g. TU Verification instructions, I D Act & HOER instructions.",
  },
  {
    name: "Compliance Guidance (FAQs & Case Compendia)",
    shortCode: "COMP",
    definition: "Plain-language compliance aids: FAQs on specific Acts, and compendia of court cases organized by Act.",
    parentName: null,
    status: "ACTIVE",
    notes: "CONFIRMED, real recurring pattern distinct from the Acts themselves.",
  },
  {
    name: "Governance and Administration",
    shortCode: "GOV",
    definition: "CLC's own internal/administrative matters, not tied to a specific labour-law enforcement function.",
    parentName: null,
    status: "ACTIVE",
    notes: "Parent tag for the child below.",
  },
  {
    name: "Governance and Administration > Personnel/Establishment",
    shortCode: "GOV-PE",
    definition: "Transfer policy, Labour Enforcement Officer recruitment rules and work norms, internal MoUs.",
    parentName: "Governance and Administration",
    status: "ACTIVE",
    notes: "CONFIRMED, real evidence: Transfer Policy, LEO Recruitment Rules, Work Norms, MoU. DEFAULT-HIDE.",
  },
];

const CLC_INSTRUMENT_TYPE_TAGS: InstrumentTag[] = [
  { name: "Order", shortCode: "ORD", definition: "A directive order, e.g. a VDA Order." },
  { name: "Corrigendum", shortCode: "COR", definition: "A correction notice to a previously issued document (frequently to VDA Orders)." },
  { name: "Instruction/Clarification", shortCode: "INST", definition: "An instruction or clarification on a specific Act's application." },
  { name: "Act", shortCode: "ACT", definition: "The text of a labour Act itself (reference library)." },
  { name: "Rules", shortCode: "RUL", definition: "Rules notified under a labour Act, or internal service rules." },
  { name: "Compendium", shortCode: "CMP", definition: "A compendium of court cases organized by Act." },
  { name: "FAQ", shortCode: "FAQ", definition: "A frequently-asked-questions compliance document for a specific Act." },
  { name: "Policy", shortCode: "POL", definition: "An internal administrative policy document, e.g. Transfer Policy." },
  {
    name: "Notice",
    shortCode: "NOT",
    definition: "A general notice.",
    notes: "Not directly evidenced in this pressure-test sample -- kept available, same treatment DoT gave 'Guidelines' when its section returned zero rows at scrape time.",
  },
  {
    name: "Circular",
    shortCode: "CIR",
    definition: "A circular issued by CLC.",
    notes: "Not directly evidenced in this pressure-test sample -- CLC's own 'Circulars/Orders' section name implies this is a real possible instrument.",
  },
];

const REGULATORS: Array<{
  code: string;
  name: string;
  websiteUrl: string;
  subjectTags: SubjectTag[];
  instrumentTags: InstrumentTag[];
}> = [
  { code: "EPFO", name: "Employees' Provident Fund Organisation", websiteUrl: "https://www.epfindia.gov.in", subjectTags: EPFO_SUBJECT_TAGS, instrumentTags: EPFO_INSTRUMENT_TYPE_TAGS },
  { code: "ESIC", name: "Employees' State Insurance Corporation", websiteUrl: "https://www.esic.gov.in", subjectTags: ESIC_SUBJECT_TAGS, instrumentTags: ESIC_INSTRUMENT_TYPE_TAGS },
  { code: "CLC", name: "Chief Labour Commissioner (Central)", websiteUrl: "https://clc.gov.in", subjectTags: CLC_SUBJECT_TAGS, instrumentTags: CLC_INSTRUMENT_TYPE_TAGS },
];

async function main() {
  console.log("Seeding Employment Law taxonomy (EPFO, ESIC, CLC)...");

  const domain = await prisma.domain.upsert({
    where: { name: "Employment Law" },
    update: {},
    create: { name: "Employment Law", description: "Central labour and social-security regulators." },
  });
  console.log(`Domain "Employment Law" ready (id: ${domain.id})`);

  for (const reg of REGULATORS) {
    const regulator = await prisma.regulator.upsert({
      where: { code: reg.code },
      update: { domainId: domain.id },
      create: {
        code: reg.code,
        name: reg.name,
        domainId: domain.id,
        websiteUrl: reg.websiteUrl,
      },
    });
    console.log(`Regulator "${reg.code}" ready (id: ${regulator.id})`);

    // Subject tags: parents first, then children (so parentId can resolve).
    const subjectIdByName = new Map<string, string>();
    const parentsFirst = [...reg.subjectTags].sort((a, b) =>
      a.parentName === null && b.parentName !== null ? -1 : a.parentName !== null && b.parentName === null ? 1 : 0
    );

    for (const tag of parentsFirst) {
      const parentId = tag.parentName ? subjectIdByName.get(tag.parentName) ?? null : null;
      if (tag.parentName && !parentId) {
        throw new Error(
          `Parent tag "${tag.parentName}" not found/not yet created for child "${tag.name}" (regulator ${reg.code}) -- check ordering.`
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
      console.log(`  [${reg.code}] Subject: ${tag.name} (${tag.status})`);
    }

    // Instrument Type tags -- all flat, no hierarchy.
    for (const tag of reg.instrumentTags) {
      await prisma.taxonomyTag.upsert({
        where: {
          regulatorId_facet_name: {
            regulatorId: regulator.id,
            facet: "INSTRUMENT_TYPE",
            name: tag.name,
          },
        },
        update: { shortCode: tag.shortCode, definition: tag.definition, notes: tag.notes },
        create: {
          regulatorId: regulator.id,
          facet: "INSTRUMENT_TYPE",
          name: tag.name,
          shortCode: tag.shortCode,
          definition: tag.definition,
          status: "ACTIVE",
          versionAdded: "v1.0",
          notes: tag.notes,
        },
      });
      console.log(`  [${reg.code}] Instrument Type: ${tag.name}`);
    }

    await seedStandardStatusTags(regulator.id, reg.code);
  }

  console.log("Employment Law taxonomy seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
