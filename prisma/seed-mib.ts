/**
 * Seed script: MIB (Ministry of Information & Broadcasting) taxonomy.
 *
 * Same idempotent upsert pattern as seed-dot.ts / seed-mtcte.ts -- safe to
 * re-run. MIB gets its own Domain ("Information and Broadcasting") rather
 * than joining DoT/MTCTE's "Telecom" Domain: broadcasting content
 * regulation, film certification, and press registration have no real
 * vocabulary overlap with telecom licensing or equipment certification.
 *
 * EVIDENCE BASE (real, 2026-07-31/08-02): built against the complete real
 * 1,024-document MIB corpus scraped from 18 real site sections -- NOT the
 * earlier 203-document subset, which turned out to be only the 3 sections
 * the original scraper happened to hardcode (~18% of the real corpus, the
 * same incomplete-section-list failure already hit on DoT and MeitY). Every
 * tag below has real title citations behind it; counts in the notes are
 * real matched counts against all 1,024 titles, not estimates.
 *
 * TAG COUNT NOTE: the review table presented 29 Subject rows, but the last
 * of those ("Under Review - no confident tag", 11 real documents) is the
 * residual bucket, not a tag -- those documents are handled by the
 * pipeline's own needsReview flag, which is what it exists for. So 28 real
 * Subject tags are seeded here, not 29. Flagged explicitly rather than
 * quietly inventing a 29th tag to make the number match.
 *
 * Run with: npx tsx prisma/seed-mib.ts
 */

import "dotenv/config"; // required when run standalone via tsx -- see seed-dot.ts's note
import { prisma } from "../lib/prisma";
import { seedStandardStatusTags } from "./seed-shared";

const SUBJECT_TAGS: Array<{
  name: string;
  shortCode: string;
  definition: string;
  status: "ACTIVE" | "UNDER_REVIEW" | "DEPRECATED";
  notes?: string;
}> = [
  {
    name: "Public Communications & Media/Cultural Event Coverage",
    shortCode: "PRCOM",
    definition:
      "Ministry press releases and public communications reporting on events, festivals, summits, ministerial appearances, and cultural programming -- announcements ABOUT activity, not regulatory instruments themselves.",
    status: "ACTIVE",
    notes:
      "CONFIRMED -- 444 real titles, the single largest Subject by volume (43% of the corpus). Created by explicit decision after reviewing the real Press Releases section (509 docs): the overwhelming majority are event/PR coverage (MIFF festival day-by-day reporting, WAVES summit promotion, ministerial yoga-day appearances, commemorative book releases), not regulatory instruments. Folding them into the substantive regulatory tags would have diluted every real tag with hundreds of PR items. RULE: a press release announcing a REAL regulatory action (e.g. 'Government Notifies TV Rating Policy (TRP) 2026') goes to that action's substantive Subject, NOT here -- only coverage-of-activity lands here.",
  },
  {
    name: "Ministry Internal Administration (HR/Recruitment/Establishment)",
    shortCode: "ADMIN",
    definition:
      "Internal ministry establishment matters: recruitment rules, vacancies, deputations, seniority, committee constitution/reconstitution, delegation of powers, and internal office administration.",
    status: "ACTIVE",
    notes:
      "CONFIRMED -- 79 real titles. Spans the Vacancies section (32 real docs) plus committee-constitution and establishment items scattered through Notices and Acts/Policy/Guidelines. Industry-facing regulation does NOT belong here even when procedurally administrative.",
  },
  {
    name: "FM/CRS Radio Broadcasting Licensing",
    shortCode: "FMRAD",
    definition:
      "Private FM radio and Community Radio Station (CRS) licensing, auctions, phase rollouts, operational channel lists, and Akashvani/public radio network matters.",
    status: "ACTIVE",
    notes:
      "CONFIRMED -- 63 real titles, including the entire real FM Radio Auctions section (23 docs). CAUTION, real false-positive found: a bare 'FM' regex matches 'FM Nirmala Sitharaman' (the Finance Minister) in press-release titles -- word-boundary matching alone is insufficient, those were manually reclassified to Public Communications.",
  },
  {
    name: "Broadcast Content & Programme Code Compliance",
    shortCode: "PCODE",
    definition:
      "Programme Code and Advertising Code adherence under the Cable Television Networks (Regulation) Act, 1995: sensitive/objectionable content restrictions, surrogate and misleading advertising, child-protection-in-media obligations, and content-conduct advisories to broadcasters.",
    status: "ACTIVE",
    notes:
      "NEW TAG (2026-08-02) -- 59 real titles. Did not exist in the 203-document version because the real Advisories section (175 docs) was entirely unscraped then. Real citations: 'Advisory to all Media channels to refrain from showing live coverage of defence operations...', 'Advisory on Celebrity/Influencer Endorsements... of Offshore Online Betting/Gambling Platforms', 'Advisory lmplementation of the provisions of the Juvenile Justice and POCSO regarding prohibition on disclosure of identity of children by media'.",
  },
  {
    name: "Ministry & Autonomous Body Financial/Administrative Reporting",
    shortCode: "FINRPT",
    definition:
      "Ministry and autonomous-body financial and statutory reporting: annual reports, audited accounts, budget overviews, detailed demands for grants, internal audit, citizen charters, and monthly cabinet summaries.",
    status: "ACTIVE",
    notes:
      "NEW TAG (2026-08-02) -- 51 real titles across 7 real sections (Annual Reports, Autonomous Bodies, Budget Overview, Detailed Demand for Grant, Internal Audit, Citizen Charter, Monthly Summary for Cabinet, Accounting and Reports), none of which existed in the 203-doc corpus. Distinct from Ministry Internal Administration: that is establishment/HR, this is financial and statutory reporting. Many of these rows carry a real financialYear instead of a date.",
  },
  {
    name: "Cable TV / MSO / LCO Regulation",
    shortCode: "CABLE",
    definition:
      "Cable television network regulation: MSO and LCO registration, cancellation and renewal, interconnection, LCN/seeding data obligations, unauthorised transmission enforcement, and Cable Television Networks Act/Rules matters.",
    status: "ACTIVE",
    notes:
      "CONFIRMED -- 50 real titles (up substantially from the 203-doc version, driven by the newly-scraped Advisories section). Real source-data typos required broadened matching, NOT a scraper bug: 'Cables Television Network Rules, 1994' (extra s) and 'Multy Seystem Operator' (misspelled MSO) are the site's own spellings.",
  },
  {
    name: "Film Certification & Exhibition",
    shortCode: "FILMC",
    definition:
      "CBFC film certification process and criteria under the Cinematograph Act/Rules, certification exemptions, anti-piracy and copyright enforcement, and public exhibition requirements.",
    status: "ACTIVE",
    notes:
      "CONFIRMED -- 38 real titles. RULE: film-festival logistics and ceremony coverage (MIFF/IFFI day-by-day press releases) are NOT certification substance and go to Public Communications -- a real false-positive cohort caught by manual review of the 'film festival' keyword.",
  },
  {
    name: "Government Publicity Campaign Advisories",
    shortCode: "PUBCAM",
    definition:
      "Advisories requesting broadcasters give publicity to government campaigns, national observances, and public-awareness drives (Mission Indradhanush, Swachh Bharat, COVID-19 messaging, Yoga Day, Kargil Vijay Diwas).",
    status: "ACTIVE",
    notes:
      "NEW TAG (2026-08-02) -- 37 real titles, all from the newly-scraped Advisories section. Genuinely distinct from Programme Code Compliance: these ask broadcasters to CARRY something, rather than restricting what they may broadcast.",
  },
  {
    name: "Content Accessibility (Disability Compliance)",
    shortCode: "ACCESS",
    definition:
      "Accessibility obligations for persons with disabilities: sign-language interpretation carriage, captioning, audio description, and OTT accessibility standards for hearing- and visually-impaired audiences.",
    status: "ACTIVE",
    notes:
      "CONFIRMED -- 34 real titles, promoted decisively from the 203-doc version's thinner evidence. The recurring real sign-language-interpretation advisory family (Republic Day / Independence Day / Rashtriya Ekta Diwas, reissued annually since at least 2014) is 22 of these -- each a distinct real filing, not duplicates.",
  },
  {
    name: "Digital Media & OTT Regulation (IT Rules 2021)",
    shortCode: "OTT",
    definition:
      "Regulation of online curated content and digital news publishers under the IT (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021, including the three-tier grievance mechanism and OTT content obligations.",
    status: "ACTIVE",
    notes:
      "CONFIRMED -- 19 real titles. Real regex false-positive found and fixed: a bare 'OTT' pattern matched inside the word 'allotted'; word-boundary matching is required. Several WAVES-OTT-platform promotional press releases were manually reclassified to Public Communications since they concern a government platform's growth, not regulation.",
  },
  {
    name: "Judicial Compliance / Court Orders",
    shortCode: "COURT",
    definition:
      "Compliance directions issued pursuant to Supreme Court or High Court orders and writ petitions affecting broadcasters or the Ministry.",
    status: "ACTIVE",
    notes:
      "CONFIRMED -- 18 real titles, comfortably clearing the promotion bar. Was UNDER_REVIEW in the 203-doc version on thinner evidence; the Advisories section supplied the rest. Real citations include Tehseen S. Poonawalla vs Union of India (lynching/mob violence coverage) and W.P.(C) No. 8284 of 2026 Badminton Association of India.",
  },
  {
    name: "International Co-production Agreements",
    shortCode: "COPROD",
    definition:
      "Bilateral audio-visual co-production treaties and agreements between India and foreign governments.",
    status: "ACTIVE",
    notes:
      "CONFIRMED -- 16 real titles, one per counterpart country (Australia, Portugal, Russia, Israel, Bangladesh, Korea, China, Canada, Spain and others). A clean, unambiguous real family.",
  },
  {
    name: "Uplinking/Downlinking & Channel Permissions",
    shortCode: "UPDOWN",
    definition:
      "Satellite TV channel uplinking and downlinking permissions, teleport authorisations, channel surrenders, and prohibitions on carrying specific channels.",
    status: "ACTIVE",
    notes:
      "CONFIRMED -- 12 real titles. Real source typos matched deliberately ('downllnk', 'Prohibltlon') -- the site's own spelling, not a scraper artifact.",
  },
  {
    name: "Television Rating Agencies / TRP Policy",
    shortCode: "TRP",
    definition:
      "Television audience measurement policy: rating agency registration, TRP guidelines and their amendments, and directions affecting ratings publication.",
    status: "ACTIVE",
    notes:
      "CONFIRMED -- 12 real titles, including the real Television Rating Policy 2026 and its draft/amendment lineage. NOTE: this tag was accidentally omitted from an earlier analysis script run, wrongly sending 7 real TRP titles to the residual bucket -- caught by manual residual review, fixed, and re-run. That was an analysis-script bug, not a finding about the data.",
  },
  {
    name: "AVGC Sector Promotion",
    shortCode: "AVGC",
    definition:
      "Animation, Visual effects, Gaming and Comics (AVGC-XR) sector development: task forces, the Indian Institute of Creative Technologies (IICT), and skilling initiatives.",
    status: "ACTIVE",
    notes:
      "CONFIRMED -- 12 real titles. The AVGC press-release cohort is institutional-promotion PR and was deliberately routed to Public Communications; what remains here is real policy/task-force instruments.",
  },
  {
    name: "TV Channel Monitoring & Enforcement",
    shortCode: "MONITOR",
    definition:
      "Monitoring machinery and enforcement action against channels: state/district monitoring committees, EMMC monitoring facilitation, off-air orders, and distribution stoppages.",
    status: "ACTIVE",
    notes:
      "NEW TAG (2026-08-02) -- 10 real titles. Distinct from Programme Code Compliance: that tag is the content standard, this is the enforcement apparatus applying it. Real citations: 'Stopping Distribution of TV Channels namely Mangalam & Whistle TV', 'Advisory Off-Air Order dated 05-09-2018 in respect of CVR Health TV Channel'.",
  },
  {
    name: "DTH/HITS/IPTV Licensing",
    shortCode: "DTH",
    definition:
      "Direct-To-Home, HITS, and IPTV distribution-platform licensing, permissions, and service-provider obligations.",
    status: "ACTIVE",
    notes: "CONFIRMED -- 10 real titles.",
  },
  {
    name: "Doordarshan/Akashvani Mandatory Carriage",
    shortCode: "DDCARR",
    definition:
      "Mandatory carriage obligations for Doordarshan and Prasar Bharati channels on cable and other distribution networks, and related last-mile/infrastructure directions.",
    status: "ACTIVE",
    notes:
      "NEW TAG (2026-08-02) -- 9 real titles. Real citations: 'Issue of gazette notification of mandatory carriage of DD Retro and 11 regional channels of Doordarshan', 'Advisory to cable operators to carry the 28 Doordarshan Mandatory channel'.",
  },
  {
    name: "Sector Research & Statistical Publications",
    shortCode: "RESRCH",
    definition:
      "Substantive research and statistical publications on the media and entertainment sector issued by the Ministry.",
    status: "ACTIVE",
    notes:
      "NEW TAG (2026-08-02) -- 9 real titles, all from the newly-discovered E-Book/Handbook section. Real citations: 'Statistical Handbook on Media & Entertainment Sector 2024-25', 'Legal Currents - A Regulatory Handbook on India's Media & Entertainment Sector', 'The Impact of Piracy on India's Online Video Sector & Creative Economy'. Deliberately separated from that section's internal-governance and campaign-outcome items, which go to Ministry Internal Administration.",
  },
  {
    name: "Film Promotion & Financial Incentive Schemes",
    shortCode: "FILMP",
    definition:
      "Financial assistance and incentive schemes promoting Indian cinema, including the DCDFC scheme and domestic film-festival support.",
    status: "ACTIVE",
    notes: "CONFIRMED -- 7 real titles.",
  },
  {
    name: "National Film Awards Administration",
    shortCode: "NFA",
    definition:
      "Administration of the National Film Awards: regulations, eligibility, and the awards process.",
    status: "ACTIVE",
    notes:
      "CONFIRMED -- 5 real titles (e.g. 'Regulations for 71st National Film Awards', 'Regulations of 70th National Film Awards'). Promoted from UNDER_REVIEW in the 203-doc version: real evidence now clears the bar. Award CEREMONY coverage goes to Public Communications; the administering regulations stay here.",
  },
  {
    name: "Sports Broadcasting Signal Sharing (Prasar Bharati)",
    shortCode: "SPORTS",
    definition:
      "Mandatory sharing of sports broadcasting signals with Prasar Bharati under the Sports Broadcasting Signals (Mandatory Sharing with Prasar Bharati) Act, 2007, and notification of events of national importance.",
    status: "ACTIVE",
    notes:
      "CONFIRMED -- 5 real titles. Promoted from UNDER_REVIEW in the 203-doc version. Real matching needed to cover both 'sporting events' and 'sports events' phrasings, which the site uses interchangeably.",
  },
  {
    name: "Press & Periodicals Registration",
    shortCode: "PRESS",
    definition:
      "Registration of newspapers and periodicals under the Press and Registration of Periodicals Act, 2023 and its Rules.",
    status: "ACTIVE",
    notes:
      "CONFIRMED -- 3 real titles, including the real parent Act and Rules. Promoted from UNDER_REVIEW: thin but structurally load-bearing (it is a distinct statutory regime, not a subtopic of broadcasting), matching the MTCTE 'Appeals' precedent of keeping a low-volume but genuinely distinct regime as its own tag.",
  },
  {
    name: "Draft Broadcasting Services (Regulation) Bill, 2023",
    shortCode: "BSRB",
    definition:
      "The draft Broadcasting Services (Regulation) Bill, 2023 and its stakeholder consultation process.",
    status: "ACTIVE",
    notes:
      "CONFIRMED -- 3 real titles. Kept as its own Subject rather than folded into a generic consultation bucket because it is a real, named, still-live legislative instrument that a user would search for by name.",
  },
  {
    name: "Public Service Broadcasting Obligation",
    shortCode: "PSB",
    definition:
      "The obligation on private broadcasters to carry public-service content.",
    status: "ACTIVE",
    notes:
      "CONFIRMED -- 3 real titles, all real reissues of the same 'Advisory on Obligation of Public Service Broadcasting' instrument (2023 dates). Thin, but a real named obligation distinct from mandatory carriage (which concerns specific Doordarshan channels, not content character).",
  },
  {
    name: "Draft Telecom TV/Radio Rules 2026",
    shortCode: "TELRUL",
    definition:
      "The draft Telecommunications (Television, Radio and Associated Services) Rules, 2026 and their consultation.",
    status: "ACTIVE",
    notes:
      "CONFIRMED -- 2 real titles (the draft itself plus its announcing press release). A significant real regulatory development: it proposes moving TV/radio service authorisation under the Telecommunications Act framework.",
  },
  {
    name: "Self-Regulatory Body Registration & Recognition",
    shortCode: "SRB",
    definition:
      "Ministry registration and recognition of Level-II self-regulating bodies in the broadcasting sector.",
    status: "ACTIVE",
    notes:
      "NEW TAG (2026-08-02) -- 2 real titles: registration of NBF-PNBSA (News Broadcasters Federation) and BCCC (Broadcasting Content Complaints Council). Thin, but this is the real statutory self-regulation tier of the content-regulation architecture, so it is kept visible rather than buried in a catch-all. Watch on the next scrape: if it stays at 2, reconsider folding into Broadcast Content & Programme Code Compliance.",
  },
  {
    name: "Grievance Redressal",
    shortCode: "GRIEV",
    definition:
      "Viewer and stakeholder grievance-redressal mechanisms and complaint handling.",
    status: "UNDER_REVIEW",
    notes:
      "HELD UNDER_REVIEW (2026-08-02) -- only 1 real title matched across the full 1,024-document corpus ('Advisory Scroller to be carried by broadcasters in support of self-regulation for grievance against objectionable advertisements'), and that one arguably belongs under Broadcast Content & Programme Code Compliance anyway. This is BELOW the 3-hit floor set by the MTCTE 'Appeals' precedent, so it does not get promoted. ALREADY CHECKED against the full real corpus -- do not silently re-investigate this without new scraped data. Most real grievance content lives inside the IT Rules 2021 three-tier mechanism and is tagged under Digital Media & OTT Regulation instead. Being UNDER_REVIEW, it is excluded from the classifier's options by fetchActiveTaxonomy(), which is intended.",
  },
];

// Instrument Type is flat (no hierarchy), matching DoT/MTCTE. Rebuilt
// against the real 1,024-document corpus: the 203-doc version's 11 proposed
// types did NOT transfer cleanly -- the newly-scraped sections introduced
// real instrument types that genuinely did not exist before (Press Release,
// Vacancy Notice, Budget/Financial Document, Annual Report, E-Book,
// Monthly Cabinet Summary, Citizen Charter, FM Radio Auction Notice,
// International Agreement, Regulations as distinct from Rules, and a Public
// Consultation type).
const INSTRUMENT_TYPE_TAGS: Array<{
  name: string;
  shortCode: string;
  definition: string;
  status: "ACTIVE" | "UNDER_REVIEW" | "DEPRECATED";
  notes?: string;
}> = [
  {
    name: "Press Release",
    shortCode: "PR",
    definition: "An official Ministry press release issued for public communication.",
    status: "ACTIVE",
    notes: "CONFIRMED -- 509 real documents, the entire real Press Releases section. By far the highest-volume real instrument type.",
  },
  {
    name: "Advisory",
    shortCode: "ADV",
    definition: "A formal advisory issued to broadcasters, channels, or platforms.",
    status: "ACTIVE",
    notes: "CONFIRMED -- 154 real documents. MIB's characteristic instrument; the real Advisories section alone holds 175 documents.",
  },
  {
    name: "Guidelines",
    shortCode: "GDL",
    definition: "Issued guidelines setting out requirements or procedures.",
    status: "ACTIVE",
    notes: "CONFIRMED -- 41 real documents.",
  },
  {
    name: "Vacancy / Recruitment Notice",
    shortCode: "VAC",
    definition: "A notice advertising a post, deputation, or appointment.",
    status: "ACTIVE",
    notes: "NEW (2026-08-02) -- 28 real documents from the newly-scraped Vacancies section. Real rows here carry TWO dates (posting date and last date to apply).",
  },
  {
    name: "Order",
    shortCode: "ORD",
    definition: "A formal order or direction.",
    status: "ACTIVE",
    notes: "CONFIRMED -- 24 real documents.",
  },
  {
    name: "Budget / Financial Document",
    shortCode: "BUD",
    definition: "Budget overviews, detailed demands for grants, expenditure and receipt reports, and accounts-at-a-glance documents.",
    status: "ACTIVE",
    notes: "NEW (2026-08-02) -- 24 real documents. These typically carry a real financial year instead of a publication date.",
  },
  {
    name: "E-Book / Handbook / Statistical Publication",
    shortCode: "EBK",
    definition: "A published handbook, e-book, or statistical compilation.",
    status: "ACTIVE",
    notes: "NEW (2026-08-02) -- 24 real documents. These link to an internal flipbook viewer page (/en/flipbook/N), not a downloadable file -- a real third link shape the scraper now types explicitly.",
  },
  {
    name: "Rules",
    shortCode: "RUL",
    definition: "Statutory rules made under an Act.",
    status: "ACTIVE",
    notes: "CONFIRMED -- 20 real documents.",
  },
  {
    name: "Notification / Notice",
    shortCode: "NOT",
    definition: "A gazette notification or public notice.",
    status: "ACTIVE",
    notes: "CONFIRMED -- 17 real documents.",
  },
  {
    name: "International Agreement",
    shortCode: "IAG",
    definition: "A bilateral treaty or agreement with a foreign government.",
    status: "ACTIVE",
    notes: "NEW (2026-08-02) -- 16 real documents (the audio-visual co-production agreements). Previously these would have been mistyped as a domestic Act; they are a genuinely different instrument.",
  },
  {
    name: "Annual Report / Annual Accounts",
    shortCode: "ANR",
    definition: "An annual report or audited annual accounts of the Ministry or an autonomous body.",
    status: "ACTIVE",
    notes: "NEW (2026-08-02) -- 16 real documents from the newly-scraped Annual Reports and Autonomous Bodies sections.",
  },
  {
    name: "FM Radio Auction Notice",
    shortCode: "AUC",
    definition: "Auction notices, notices inviting applications (NIA), bid queries, and auction rules for FM radio channels.",
    status: "ACTIVE",
    notes: "NEW (2026-08-02) -- 15 real documents from the newly-scraped FM Radio Auctions section.",
  },
  {
    name: "Regulations",
    shortCode: "REG",
    definition: "Regulations governing a scheme or process, as distinct from statutory Rules made under an Act.",
    status: "ACTIVE",
    notes: "NEW (2026-08-02) -- 13 real documents, chiefly the National Film Awards regulations. Kept distinct from 'Rules' because MIB's own titles use the two terms for genuinely different instruments.",
  },
  {
    name: "Act / Amendment Act",
    shortCode: "ACT",
    definition: "A primary Act of Parliament or an amending Act.",
    status: "ACTIVE",
    notes: "CONFIRMED -- 8 real documents.",
  },
  {
    name: "Policy",
    shortCode: "POL",
    definition: "A stated policy document.",
    status: "ACTIVE",
    notes: "CONFIRMED -- 8 real documents.",
  },
  {
    name: "Monthly Cabinet Summary",
    shortCode: "MCS",
    definition: "The Ministry's monthly summary submitted for the Cabinet.",
    status: "ACTIVE",
    notes: "NEW (2026-08-02) -- 6 real documents. Titled only by month and year (e.g. 'December 2024'), a real, recognisable periodic series.",
  },
  {
    name: "Public Consultation / Draft for Comments",
    shortCode: "CONS",
    definition: "A draft instrument or consultation soliciting stakeholder comments.",
    status: "ACTIVE",
    notes: "NEW (2026-08-02) -- 5 real documents. Real citations use the distinctive 'Soliciting suggestions feedbacks comments inputs views...' phrasing.",
  },
  {
    name: "Citizen Charter",
    shortCode: "CC",
    definition: "The Ministry's citizen charter for a given year.",
    status: "ACTIVE",
    notes: "NEW (2026-08-02) -- 4 real documents from the newly-scraped Citizen Charter section.",
  },
  {
    name: "Corrigendum",
    shortCode: "COR",
    definition: "A correction to a previously issued document.",
    status: "ACTIVE",
    notes:
      "CONFIRMED -- 3 real documents. Kept as its own type here, UNLIKE the MTCTE decision to fold a single Corrigendum into Notification: MIB has multiple real instances spanning different parent instrument types (a notification corrigendum and a vacancy-advertisement corrigendum), so it is not a one-off variant of a single sibling.",
  },
  {
    name: "Circular",
    shortCode: "CIR",
    definition: "An administrative circular.",
    status: "ACTIVE",
    notes: "CONFIRMED -- 3 real documents.",
  },
  {
    name: "Scheme",
    shortCode: "SCH",
    definition: "A named government scheme document.",
    status: "ACTIVE",
    notes: "CONFIRMED -- 3 real documents (chiefly the DCDFC scheme lineage).",
  },
  {
    name: "Office Memorandum",
    shortCode: "OM",
    definition: "An internal office memorandum.",
    status: "ACTIVE",
    notes: "CONFIRMED -- 2 real documents. Note the real Office Memorandums SECTION holds 6 documents, but only 2 are titled as OMs; the others are typed by their own real form.",
  },
  {
    name: "Other / Administrative",
    shortCode: "OTH",
    definition:
      "A real document whose instrument type cannot be determined from its title alone -- typically generic administrative items such as committee constitutions, data-submission requests, or bare 'Details of...' listings.",
    status: "ACTIVE",
    notes:
      "CONFIRMED -- 81 real documents (8% of the corpus). Deliberately seeded as a real, honest catch-all rather than force-fitting these into a specific type they do not actually claim. A document landing here is NOT a pipeline failure; it reflects real MIB titles that genuinely do not name their own instrument type. If this bucket grows past roughly 15% on a future scrape, revisit for a missed real type.",
  },
  {
    name: "Tender Notice",
    shortCode: "TND",
    definition: "A tender notice inviting bids, carrying a real tender ID and due date.",
    status: "UNDER_REVIEW",
    notes:
      "HELD UNDER_REVIEW (2026-08-02) -- the real Tender Notices section EXISTS with a genuinely distinct real column shape (it has real 'Tender ID' and 'Due Date' columns no other section has), but the live page currently returns Drupal's own real empty-state marker (class=views-empty, 'no content available') and 0 documents. The Reports index claims a historical count of 12, so the section has held real documents before. ZERO real documents in the corpus means there is no evidence to classify against, so this is not promoted to ACTIVE and is correctly excluded from the classifier's options. Promote it the moment a real scrape returns tender rows -- this is a live-empty section, not a wrong tag.",
  },
];

async function main() {
  console.log("Seeding MIB taxonomy...");

  const domain = await prisma.domain.upsert({
    where: { name: "Information and Broadcasting" },
    update: {},
    create: {
      name: "Information and Broadcasting",
      description:
        "Broadcasting, film, and print/digital media regulators. Deliberately separate from the Telecom domain (DoT/MTCTE): confirmed zero real taxonomy overlap between broadcasting content regulation and telecom licensing/equipment certification.",
    },
  });
  console.log(`Domain "Information and Broadcasting" ready (id: ${domain.id})`);

  const regulator = await prisma.regulator.upsert({
    where: { code: "MIB" },
    update: { domainId: domain.id },
    create: {
      code: "MIB",
      name: "Ministry of Information and Broadcasting",
      domainId: domain.id,
      websiteUrl: "https://mib.gov.in",
    },
  });
  console.log(`Regulator "MIB" ready (id: ${regulator.id})`);

  for (const tag of SUBJECT_TAGS) {
    await prisma.taxonomyTag.upsert({
      where: {
        regulatorId_facet_name: { regulatorId: regulator.id, facet: "SUBJECT", name: tag.name },
      },
      update: {
        shortCode: tag.shortCode,
        definition: tag.definition,
        status: tag.status,
        notes: tag.notes,
      },
      create: {
        regulatorId: regulator.id,
        facet: "SUBJECT",
        name: tag.name,
        shortCode: tag.shortCode,
        definition: tag.definition,
        status: tag.status,
        versionAdded: "v1.0",
        notes: tag.notes,
      },
    });
    console.log(`  Subject: ${tag.name} (${tag.status})`);
  }

  for (const tag of INSTRUMENT_TYPE_TAGS) {
    await prisma.taxonomyTag.upsert({
      where: {
        regulatorId_facet_name: {
          regulatorId: regulator.id,
          facet: "INSTRUMENT_TYPE",
          name: tag.name,
        },
      },
      update: {
        shortCode: tag.shortCode,
        definition: tag.definition,
        status: tag.status,
        notes: tag.notes,
      },
      create: {
        regulatorId: regulator.id,
        facet: "INSTRUMENT_TYPE",
        name: tag.name,
        shortCode: tag.shortCode,
        definition: tag.definition,
        status: tag.status,
        versionAdded: "v1.0",
        notes: tag.notes,
      },
    });
    console.log(`  Instrument Type: ${tag.name} (${tag.status})`);
  }

  await seedStandardStatusTags(regulator.id, "MIB");

  const subjectActive = SUBJECT_TAGS.filter((t) => t.status === "ACTIVE").length;
  const instrumentActive = INSTRUMENT_TYPE_TAGS.filter((t) => t.status === "ACTIVE").length;
  console.log(
    `MIB taxonomy seed complete: ${SUBJECT_TAGS.length} Subject tags (${subjectActive} ACTIVE), ` +
      `${INSTRUMENT_TYPE_TAGS.length} Instrument Type tags (${instrumentActive} ACTIVE).`
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
