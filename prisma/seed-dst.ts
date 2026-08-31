/**
 * Seed script: DST (Department of Science & Technology) taxonomy.
 *
 * Creates/updates (idempotently, via upsert -- safe to re-run):
 *   1. The "Science and Technology" Domain (new -- DST has no overlap with
 *      Telecom, Employment Law, Information and Broadcasting, or Financial
 *      Services).
 *   2. The "DST" Regulator under that Domain.
 *   3. Every TaxonomyTag row for SUBJECT (9), INSTRUMENT_TYPE (8), and
 *      STATUS (7, in two Subject-scoped groups) -- sourced directly from
 *      DST_Regulatory_Taxonomy_v2_0.xlsx (the actual file provided; the
 *      build request referenced "v2_1", which does not exist -- flagged to
 *      the user, proceeding on v2.0 as the real, confirmed source).
 *
 *   STATUS is the interesting part here: DST is the first regulator in this
 *   project with a genuinely hybrid Status vocabulary -- formal instruments
 *   (Gazette Notifications, Policy Documents, OMs, SFRs, Guidelines) use
 *   In Force / Draft / Under Consultation / Superseded / Amended, while the
 *   three Funding Calls & Proposals Subjects use Open / Accepting
 *   Applications / Closed / Applications Closed / Results Announced
 *   instead. This is exactly why Status became a TaxonomyTag-style facet
 *   (see the "add_status_facet" migration) instead of staying a fixed
 *   global enum. Each STATUS tag's statusAppliesToSubjectIds is populated
 *   below from the real Subject ids just created in this same run --
 *   Subjects MUST be seeded before Status for this to resolve.
 *
 * Mirrors prisma/seed-dot.ts / prisma/seed-saral-sanchar.ts's structure and
 * conventions.
 *
 * Run with:
 *   npx tsx prisma/seed-dst.ts
 */

import "dotenv/config";
import { prisma } from "../lib/prisma";

const SUBJECT_TAGS: Array<{ name: string; shortCode: string; definition: string }> = [
  {
    name: "National S&T Policies",
    shortCode: "POL",
    definition: "DST's own foundational national policy documents governing science, technology, data, and geospatial matters.",
  },
  {
    name: "Ethics & Conflict of Interest Guidelines",
    shortCode: "ETH",
    definition: "Guidelines governing conflicts of interest and ethical conduct for DST officials, reviewers, and grant recipients.",
  },
  {
    name: "Statutory Notifications & Gazette Instruments",
    shortCode: "GAZ",
    definition: "Formal Gazette of India notifications issued by or concerning DST and its autonomous bodies, including establishment/constitution notifications for new bodies like ANRF.",
  },
  {
    name: "Financial Rules & Fund Administration",
    shortCode: "FIN",
    definition: "Special Financial Rules and gazette-published financial administration frameworks for DST-managed funds, most notably the Research Development and Innovation (RDI) Fund.",
  },
  {
    name: "Service Conditions & Recruitment Rules",
    shortCode: "SVC",
    definition: "Rules and OMs governing service conditions, emoluments, and fellowship terms for DST/R&D personnel, including recruitment rules for specific posts -- distinct from one-off vacancy advertisements.",
  },
  {
    name: "Governance and Administration",
    shortCode: "GOV",
    definition: "DST's own internal administrative directives not tied to a specific policy, financial, or service-condition function.",
  },
  {
    name: "Funding Calls & Proposals (Domestic)",
    shortCode: "FCD",
    definition: "Domestic-facing calls inviting research, innovation, or S&T project proposals under DST schemes, which carry real eligibility, submission, and compliance terms for applicants.",
  },
  {
    name: "Funding Calls & Proposals (Bilateral/International)",
    shortCode: "FCI",
    definition: "Calls for joint research proposals under DST's bilateral and multilateral STI cooperation agreements, administered by the International Cooperation Division (mostly hosted on aistic.gov.in).",
  },
  {
    name: "Proposal Results & Selection Lists",
    shortCode: "RES",
    definition: "Published results/selection lists for domestic and international funding calls -- the outcome-side counterpart to the two Funding Calls Subjects above.",
  },
];

const INSTRUMENT_TYPE_TAGS: Array<{ name: string; shortCode: string; definition: string }> = [
  { name: "Gazette Notification", shortCode: "GAZ", definition: "A formal Gazette of India notification issued by or concerning DST." },
  { name: "Policy Document", shortCode: "POL", definition: "A standalone national policy text, distinct from a gazette notification or an OM." },
  { name: "Guidelines", shortCode: "GDL", definition: "Guidance or a code of conduct, less formally binding than a Rule but still an operative standard." },
  { name: "Office Memorandum (OM)", shortCode: "OM", definition: "An internal administrative directive or clarification issued by DST." },
  { name: "Special Financial Rules (SFR)", shortCode: "SFR", definition: "A gazette-published financial rule set governing the utilization of a specific DST-managed fund." },
  { name: "Draft Rules / Consultation Notice", shortCode: "DFT", definition: "A draft rule published specifically to solicit stakeholder comment before finalisation -- not yet operative." },
  { name: "Call for Proposals", shortCode: "CFP", definition: "An invitation to submit research/project proposals under a named scheme or bilateral programme." },
  { name: "Results / Selection List", shortCode: "RSL", definition: "A published list of selected, shortlisted, or sanctioned proposals following a Call for Proposals." },
];

// Formal-instrument Status group -- scoped to every Subject EXCEPT the
// three Funding Calls ones (populated below from real Subject ids).
const FORMAL_STATUS_TAGS: Array<{ name: string; shortCode: string; definition: string }> = [
  { name: "In Force", shortCode: "INF", definition: "The instrument is the current, legally/administratively operative version." },
  { name: "Draft / Under Consultation", shortCode: "DFT", definition: "Published for stakeholder comment, not yet finalised or operative." },
  { name: "Superseded", shortCode: "SUP", definition: "A later version of the same instrument, scheme, or rule set has replaced this one." },
  { name: "Amended", shortCode: "AMD", definition: "The base instrument remains in force but has been modified by a subsequent OM or notification." },
];

// Funding-call Status group -- scoped ONLY to the three Funding Calls
// Subjects.
const FUNDING_STATUS_TAGS: Array<{ name: string; shortCode: string; definition: string }> = [
  { name: "Open / Accepting Applications", shortCode: "OPEN", definition: "The Call for Proposals is currently open and accepting submissions -- applies only to the Funding Calls Subjects." },
  { name: "Closed / Applications Closed", shortCode: "CLSD", definition: "The Call for Proposals' submission window has passed -- applies only to the Funding Calls Subjects." },
  { name: "Results Announced", shortCode: "RSLT", definition: "A results/selection list has been published for this call, superseding the original call as the operative document -- applies only to the Funding Calls Subjects." },
];

const FUNDING_SUBJECT_NAMES = [
  "Funding Calls & Proposals (Domestic)",
  "Funding Calls & Proposals (Bilateral/International)",
  "Proposal Results & Selection Lists",
];

async function main() {
  console.log("Seeding DST taxonomy...");

  const domain = await prisma.domain.upsert({
    where: { name: "Science and Technology" },
    update: {},
    create: {
      name: "Science and Technology",
      description: "Science, technology, and geospatial-policy regulators.",
    },
  });
  console.log(`Domain "Science and Technology" ready (id: ${domain.id})`);

  const regulator = await prisma.regulator.upsert({
    where: { code: "DST" },
    update: { domainId: domain.id },
    create: {
      code: "DST",
      name: "Department of Science & Technology",
      domainId: domain.id,
      websiteUrl: "https://dst.gov.in",
    },
  });
  console.log(`Regulator "DST" ready (id: ${regulator.id})`);

  const subjectIdByName = new Map<string, string>();
  for (const tag of SUBJECT_TAGS) {
    const created = await prisma.taxonomyTag.upsert({
      where: { regulatorId_facet_name: { regulatorId: regulator.id, facet: "SUBJECT", name: tag.name } },
      update: { shortCode: tag.shortCode, definition: tag.definition },
      create: {
        regulatorId: regulator.id,
        facet: "SUBJECT",
        name: tag.name,
        shortCode: tag.shortCode,
        definition: tag.definition,
        status: "ACTIVE",
        versionAdded: "v2.0",
      },
    });
    subjectIdByName.set(tag.name, created.id);
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
        versionAdded: "v2.0",
      },
    });
    console.log(`  Instrument Type: ${tag.name}`);
  }

  const fundingSubjectIds = FUNDING_SUBJECT_NAMES.map((name) => {
    const id = subjectIdByName.get(name);
    if (!id) throw new Error(`Funding Subject "${name}" not found -- check SUBJECT_TAGS.`);
    return id;
  });
  const formalSubjectIds = SUBJECT_TAGS.map((t) => t.name)
    .filter((name) => !FUNDING_SUBJECT_NAMES.includes(name))
    .map((name) => subjectIdByName.get(name)!);

  for (const tag of FORMAL_STATUS_TAGS) {
    await prisma.taxonomyTag.upsert({
      where: { regulatorId_facet_name: { regulatorId: regulator.id, facet: "STATUS", name: tag.name } },
      update: { shortCode: tag.shortCode, definition: tag.definition, statusAppliesToSubjectIds: formalSubjectIds },
      create: {
        regulatorId: regulator.id,
        facet: "STATUS",
        name: tag.name,
        shortCode: tag.shortCode,
        definition: tag.definition,
        status: "ACTIVE",
        versionAdded: "v2.0",
        statusAppliesToSubjectIds: formalSubjectIds,
      },
    });
    console.log(`  Status (formal instrument): ${tag.name}`);
  }

  for (const tag of FUNDING_STATUS_TAGS) {
    await prisma.taxonomyTag.upsert({
      where: { regulatorId_facet_name: { regulatorId: regulator.id, facet: "STATUS", name: tag.name } },
      update: { shortCode: tag.shortCode, definition: tag.definition, statusAppliesToSubjectIds: fundingSubjectIds },
      create: {
        regulatorId: regulator.id,
        facet: "STATUS",
        name: tag.name,
        shortCode: tag.shortCode,
        definition: tag.definition,
        status: "ACTIVE",
        versionAdded: "v2.0",
        statusAppliesToSubjectIds: fundingSubjectIds,
      },
    });
    console.log(`  Status (funding call): ${tag.name}`);
  }

  console.log("DST taxonomy seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
