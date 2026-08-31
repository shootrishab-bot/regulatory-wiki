/**
 * Seed script: Saral Sanchar (DoT eServices) taxonomy.
 *
 * Creates/updates (idempotently, via upsert -- safe to re-run):
 *   1. The "Telecom" Domain (already exists, shared with DOT).
 *   2. The "SARALSANCHAR" Regulator under that Domain.
 *   3. Every TaxonomyTag row for SUBJECT and INSTRUMENT_TYPE, sourced from
 *      the Saral Sanchar Regulatory Taxonomy v1.0 workbook (11 Subjects, 7
 *      Instrument Types) supplied alongside the scraper -- see
 *      saral-sanchar-scraper.zip's src/taxonomy-data.json, a direct export
 *      of that workbook's Taxonomy sheet.
 *
 *   NOT ported: that workbook's third facet, "Status" (6 values: In Force /
 *   Superseded / Repealed / Amended / Draft-Under Consultation / Under
 *   Litigation-Stayed). This project's actual schema.prisma has a FIXED,
 *   global DocumentStatus enum (IN_FORCE / DRAFT_CONSULTATION / AMENDED /
 *   SUPERSEDED_REPEALED) that every regulator already shares via
 *   lib/ingest.ts's hardcoded STATUS_VALUES -- confirmed by reading
 *   schema.prisma's Facet enum directly (SUBJECT | INSTRUMENT_TYPE |
 *   APPLICABILITY | LICENSE_AUTHORISATION_TYPE, no STATUS) and its own Open
 *   Question #4, which explicitly defers ever making Status a per-regulator
 *   facet. The scraper zip's README already flagged this exact risk ("I
 *   don't have your actual prisma/schema.prisma in front of me... rename
 *   fields to match your real schema") -- this is that reconciliation.
 *   Saral Sanchar documents get the same 4-value Status classification
 *   every other regulator gets, not a bespoke 6-value one.
 *
 * Distinct regulator from DOT (not folded into it): Saral Sanchar's real
 * taxonomy (WPC licensing, REPA, SACFA, RoW, etc.) has zero overlap with
 * DoT's existing seeded Subject tags (Licensing, Spectrum Management, USOF,
 * ...) -- confirmed by direct comparison against prisma/seed-dot.ts. Same
 * domain (Telecom), same architecture as SEBI/PFRDA sharing Financial
 * Services -- see schema.prisma's Open Question #1.
 *
 * Mirrors prisma/seed-dot.ts's structure and conventions exactly.
 *
 * Run with:
 *   npx tsx prisma/seed-saral-sanchar.ts
 */

import "dotenv/config";
import { prisma } from "../lib/prisma";
import { seedStandardStatusTags } from "./seed-shared";

const SUBJECT_TAGS: Array<{ name: string; shortCode: string; definition: string }> = [
  {
    name: "Unified License, Authorisation & Migration",
    shortCode: "UL",
    definition:
      "Issuance of Unified Licenses (UL), UL-VNO, and the new NSO/VNO Authorisations under the Telecommunications Act 2023 framework, plus migration of legacy Indian Telegraph Act 1885 licenses to the new Authorisation regime.",
  },
  {
    name: "Radio Equipment Possession Authorisation (REPA)",
    shortCode: "REPA",
    definition:
      "A new, distinct authorisation category under the Telecommunications Act 2023 governing possession, testing, demonstration, renewal, surrender, disposal, and compliance of radio equipment, replacing legacy WPC possession licenses.",
  },
  {
    name: "WPC Licensing (Network, Non-Network, Satellite, Import)",
    shortCode: "WPC",
    definition:
      "Wireless Planning & Coordination wing licenses issued via Saral Sanchar for network/non-network wireless equipment, satellite licenses, import licenses, DPL/NDPL, and Equipment Type Approval (ETA), distinct from the newer REPA regime.",
  },
  {
    name: "SACFA Clearances",
    shortCode: "SACFA",
    definition:
      "Standing Advisory Committee on Frequency Allocation (SACFA) clearances for antenna and tower installations, categorized by mast height, additional antenna, exemption, and full-sitting categories.",
  },
  {
    name: "Right of Way (RoW) & Infrastructure Permissions",
    shortCode: "ROW",
    definition:
      "Central and state-level implementation of Right of Way rules for laying telecom infrastructure (towers, poles, optical fibre cable), including 'Call Before U Dig' and common duct/cable corridor provisions.",
  },
  {
    name: "Certification & Proficiency Licenses",
    shortCode: "CERT",
    definition:
      "WPC operator certificates of proficiency: Amateur Station Operator Certificate (ASOC), Radio Telephone/Telegraphy Restricted (RTR), and GMDSS certificates for maritime/aeronautical radio operators.",
  },
  {
    name: "Registrations & Aggregator Services (PM-WANI, M2M, PDOA, IP1)",
    shortCode: "REGSVC",
    definition:
      "Lighter-touch registration-based services issued via Saral Sanchar rather than full licenses: PM-WANI App Provider registration, M2M Service Provider registration, Public Data Office Aggregator (PDOA), and Infrastructure Provider Category-I (IP1) registration.",
  },
  {
    name: "Telecom Cyber Security & Equipment Compliance",
    shortCode: "TCS",
    definition:
      "Cybersecurity compliance obligations on licensees and equipment manufacturers/importers, including IMEI registration/anti-tampering rules and use of the ICDR (International Center for Digital Regulation) portal under the Telecom Cyber Security Rules.",
  },
  {
    name: "Fees, Revenue Management & SUC",
    shortCode: "FEES",
    definition:
      "License fee and Spectrum Usage Charge (SUC) payment and revenue-compliance management for Saral Sanchar licensees, administered through the linked SARAS portal.",
  },
  {
    name: "Digital Bharat Nidhi & Universal Service Obligations",
    shortCode: "DBN",
    definition:
      "Universal Service Obligation Fund (rebranded Digital Bharat Nidhi) programs administered alongside licensing, including BharatNet special-project status and EdTech/skilling reimbursement waivers.",
  },
  {
    name: "Governance and Administration",
    shortCode: "GOV",
    definition:
      "Saral Sanchar's own portal-level and DoT-internal administrative matters: nodal officer appointments, portal notifications, and platform feature changes (2FA, Entity Locker integration), not tied to a specific licensing function.",
  },
];

const INSTRUMENT_TYPE_TAGS: Array<{ name: string; shortCode: string; definition: string }> = [
  { name: "Circulars", shortCode: "CIR", definition: "A circular issued by DoT/Saral Sanchar communicating a procedural or compliance instruction." },
  { name: "DO Letters", shortCode: "DO", definition: "A Demi-Official (DO) letter, a formal but less procedurally rigid communication typically between senior officials." },
  { name: "Notifications", shortCode: "NTF", definition: "A formal notification, e.g. bringing specific sections of an Act into force, or notifying a new rule/scheme." },
  { name: "Orders", shortCode: "ORD", definition: "A directive order, most commonly a state government's order implementing a central RoW policy, or a DoT/nodal-wing administrative order." },
  {
    name: "Policy, Act and Rules",
    shortCode: "PAR",
    definition:
      "The combined category the source site itself uses for the text of Acts, statutory Rules, and formal Policy documents -- kept as one Instrument Type to match the site's own real, confirmed filter category rather than inventing a split the source does not make.",
  },
  { name: "Presentations", shortCode: "PRES", definition: "A presentation deck published as a resource, e.g. from a stakeholder consultation, SACFA/SBC meeting, or industry briefing." },
  { name: "Press Release", shortCode: "PR", definition: "A public press release, typically consumer-facing, distinct from a Circular (which is procedural/compliance-facing)." },
];

async function main() {
  console.log("Seeding Saral Sanchar taxonomy...");

  const domain = await prisma.domain.upsert({
    where: { name: "Telecom" },
    update: {},
    create: { name: "Telecom", description: "Telecommunications sector regulators." },
  });
  console.log(`Domain "Telecom" ready (id: ${domain.id})`);

  const regulator = await prisma.regulator.upsert({
    where: { code: "SARALSANCHAR" },
    update: { domainId: domain.id },
    create: {
      code: "SARALSANCHAR",
      name: "Saral Sanchar (DoT eServices)",
      domainId: domain.id,
      websiteUrl: "https://eservices.dot.gov.in",
    },
  });
  console.log(`Regulator "SARALSANCHAR" ready (id: ${regulator.id})`);

  for (const tag of SUBJECT_TAGS) {
    await prisma.taxonomyTag.upsert({
      where: {
        regulatorId_facet_name: { regulatorId: regulator.id, facet: "SUBJECT", name: tag.name },
      },
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

  await seedStandardStatusTags(regulator.id, "SARALSANCHAR");

  console.log("Saral Sanchar taxonomy seed complete.");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
