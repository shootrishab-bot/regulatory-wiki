/**
 * SINGLE SOURCE OF TRUTH for the cross-regulator CanonicalConcept mapping.
 *
 * Every downstream artefact reads THIS file and nothing else:
 *   - scripts/populate-canonical-concepts.ts  (writes the DB rows)
 *   - scripts/build-taxonomy-report.ts        (writes taxonomy-canonical-concepts.md)
 *   - scripts/build-taxonomy-workbook.ts      (writes the .xlsx for the team)
 *
 * That is deliberate: the report and the workbook cannot drift apart, because
 * neither one re-derives anything. Change a mapping decision here and re-run
 * all three.
 *
 * Every entry below was confirmed against the REAL seeded tags in Postgres on
 * 2026-09-07 by reading each regulator's own definition text, not by matching
 * tag names. Tag names are quoted exactly as they exist in TaxonomyTag.name --
 * the populate script fails loudly if any of them does not resolve.
 */

export type Facet = "SUBJECT" | "INSTRUMENT_TYPE" | "STATUS";

export interface ConceptDef {
  facet: Facet;
  name: string;
  definition: string;
  /** Audit trail: why borderline regulators are in, and why others are out. */
  notes?: string;
  /** regulator code -> that regulator's exact TaxonomyTag.name */
  tags: Record<string, string>;
}

const ALL_11 = [
  "CCI",
  "CLC",
  "DOS-ISRO",
  "DOT",
  "DST",
  "EPFO",
  "ESIC",
  "FIU",
  "MIB",
  "MTCTE",
  "SARALSANCHAR",
];

// ---------------------------------------------------------------------------
// INSTRUMENT TYPE
// ---------------------------------------------------------------------------

const INSTRUMENT_TYPE: ConceptDef[] = [
  {
    facet: "INSTRUMENT_TYPE",
    name: "Press Release",
    definition:
      "A public communications release issued by the institution to announce an action, decision, milestone, or event.",
    notes:
      "Exact name match across all six. Every definition is the same instrument form; the subject matter differs (combination approvals at CCI, mission milestones at DOS-ISRO), but subject matter is what the Subject facet carries.",
    tags: {
      CCI: "Press Release",
      "DOS-ISRO": "Press Release",
      DOT: "Press Release",
      FIU: "Press Release",
      MIB: "Press Release",
      SARALSANCHAR: "Press Release",
    },
  },
  {
    facet: "INSTRUMENT_TYPE",
    name: "Annual Report",
    definition: "The institution's own periodic annual report or audited annual accounts.",
    notes:
      "MIB's 'Annual Report / Annual Accounts' is a near-duplicate that additionally covers audited accounts of autonomous bodies -- a superset of the same instrument form, not a different one.",
    tags: {
      CCI: "Annual Report",
      "DOS-ISRO": "Annual Report",
      FIU: "Annual Report",
      MIB: "Annual Report / Annual Accounts",
    },
  },
  {
    facet: "INSTRUMENT_TYPE",
    name: "FAQ",
    definition:
      "A static frequently-asked-questions document explaining a procedure or compliance obligation.",
    notes: "Exact name match; all five definitions are materially identical.",
    tags: { CCI: "FAQ", CLC: "FAQ", "DOS-ISRO": "FAQ", FIU: "FAQ", MTCTE: "FAQ" },
  },
  {
    facet: "INSTRUMENT_TYPE",
    name: "Procurement Tender / RFP",
    definition:
      "A procurement tender or request for proposal inviting bids for goods, works, or services.",
    notes:
      "MIB's 'Tender Notice' is a near-duplicate with an identical scope ('carrying a real tender ID and due date').",
    tags: {
      CCI: "Tender / RFP",
      "DOS-ISRO": "Tender / RFP",
      FIU: "Tender / RFP",
      MIB: "Tender Notice",
    },
  },
  {
    facet: "INSTRUMENT_TYPE",
    name: "Corrigendum",
    definition: "A correction notice issued against a previously published document.",
    notes:
      "Exact name match; all five definitions are near-verbatim identical. MIB's own seeded note records that it kept Corrigendum as its own type while MTCTE folded its single corrigendum into Notification -- which is why MTCTE has no tag to map here.",
    tags: {
      CLC: "Corrigendum",
      DOT: "Corrigendum",
      EPFO: "Corrigendum",
      ESIC: "Corrigendum",
      MIB: "Corrigendum",
    },
  },
  {
    facet: "INSTRUMENT_TYPE",
    name: "RTI Response / Disclosure",
    definition:
      "Suo-motu disclosures and Right to Information responses published under the institution's RTI obligations.",
    tags: { "DOS-ISRO": "RTI Response / Disclosure", FIU: "RTI Response / Disclosure" },
  },
  {
    facet: "INSTRUMENT_TYPE",
    name: "Primary Legislation (Act)",
    definition:
      "The text of a primary Act of Parliament governing the institution's domain, or an amending Act.",
    notes:
      "DOS-ISRO's 'Act / Bill' additionally covers a lapsed Bill (the Space Activities Bill, 2019) that never became law -- a slightly wider scope, but the same instrument family. Flagged rather than excluded, because a Bill is the pre-enactment form of exactly this instrument.",
    tags: {
      CCI: "Act",
      CLC: "Act",
      DOT: "Act",
      FIU: "Act",
      MIB: "Act / Amendment Act",
      "DOS-ISRO": "Act / Bill",
    },
  },
  {
    facet: "INSTRUMENT_TYPE",
    name: "Recruitment / Vacancy Notice",
    definition:
      "A notice advertising a post, deputation, contractual engagement, or professional empanelment.",
    notes:
      "EPFO's 'Advertisement' is a near-duplicate: its definition ('a public advertisement inviting applications, e.g. for advocate/CA-firm empanelment') is the same instrument, named for the medium rather than the content.",
    tags: {
      CCI: "Recruitment / Empanelment Notice",
      FIU: "Recruitment / Vacancy Notice",
      MIB: "Vacancy / Recruitment Notice",
      EPFO: "Advertisement",
    },
  },
  {
    facet: "INSTRUMENT_TYPE",
    name: "Public Consultation / Draft for Comments",
    definition:
      "A document published at the consultation stage to solicit stakeholder comment before an instrument is finalised.",
    notes:
      "Scope nuance worth knowing: CCI's tag is the NOTICE inviting comment (and also covers case-specific commitment offers), while DST's is the DRAFT INSTRUMENT itself. MIB's covers both ('a draft instrument or consultation'). Mapped as one concept because in every case the document is the consultation-stage artefact, and a cross-regulator 'what is out for comment' query wants all four.",
    tags: {
      CCI: "Public Notice / Consultation Notice",
      DST: "Draft Rules / Consultation Notice",
      MIB: "Public Consultation / Draft for Comments",
      MTCTE: "Consultation",
    },
  },
  {
    facet: "INSTRUMENT_TYPE",
    name: "Guidelines",
    definition:
      "Non-statutory but operative guidance issued by the institution -- requirements, procedures, SOPs, or a code of conduct that is less formally binding than a Rule.",
    notes:
      "Exact name match across five. DST's definition states the shared boundary most explicitly ('less formally binding than a Rule but still an operative standard') and FIU's states the negative boundary ('distinct from a Circular and a Notification'). Both are consistent with the other three.",
    tags: {
      DOT: "Guidelines",
      DST: "Guidelines",
      ESIC: "Guidelines",
      FIU: "Guidelines",
      MIB: "Guidelines",
    },
  },
  {
    facet: "INSTRUMENT_TYPE",
    name: "Office Memorandum",
    definition:
      "An internal administrative or procedural communication issued within the institution, distinct from a public Notice or Order.",
    notes: "DST's 'Office Memorandum (OM)' is the same tag with the abbreviation appended.",
    tags: {
      DOT: "Office Memorandum",
      DST: "Office Memorandum (OM)",
      ESIC: "Office Memorandum",
      MIB: "Office Memorandum",
    },
  },
  {
    facet: "INSTRUMENT_TYPE",
    name: "Office Order",
    definition:
      "A sequentially-numbered internal directive order covering transfers, postings, and charge assignments.",
    notes:
      "Only EPFO and ESIC carry this as a distinct instrument type. Note the interaction with the 'Order' false cognate: at these two regulators internal directives go here, which is precisely why their 'Order' tag means something narrower than DOT's.",
    tags: { EPFO: "Office Order", ESIC: "Office Order" },
  },
  {
    facet: "INSTRUMENT_TYPE",
    name: "Gazette Notification",
    definition: "A notification published in the Official Gazette of India.",
    notes:
      "Deliberately kept separate from the plain 'Notification' name, which is a confirmed false cognate. 'Gazette Notification' is unambiguous: both definitions pin it to Gazette publication.",
    tags: { DOT: "Gazette Notification", DST: "Gazette Notification" },
  },
  {
    facet: "INSTRUMENT_TYPE",
    name: "Administrative Circular",
    definition:
      "A procedural or administrative circular issued by the institution to communicate an operational or compliance instruction, not rising to the formal notification register.",
    notes:
      "MTCTE's 'Circular/Letter' and SARALSANCHAR's 'Circulars' are near-duplicates with the same definition. DOS-ISRO is deliberately NOT mapped here: it folded Circular into a combined 'Notification / Circular' tag, so its tag is a merged concept that would half-conflate if linked.",
    tags: {
      CLC: "Circular",
      EPFO: "Circular",
      ESIC: "Circular",
      FIU: "Circular",
      MIB: "Circular",
      MTCTE: "Circular/Letter",
      SARALSANCHAR: "Circulars",
    },
  },
  {
    facet: "INSTRUMENT_TYPE",
    name: "Regulations",
    definition:
      "A Regulation instrument made by the institution under its parent Act, whether in draft or notified form.",
    notes:
      "MIB's definition explicitly distinguishes Regulations from statutory Rules ('as distinct from statutory Rules made under an Act'), which is consistent with CCI and ESIC both carrying Regulation(s) alongside a separate Rules-family tag.",
    tags: { CCI: "Regulation", ESIC: "Regulations", MIB: "Regulations" },
  },
  {
    facet: "INSTRUMENT_TYPE",
    name: "Named Government Scheme",
    definition: "A named government scheme document.",
    notes:
      "EPFO's is narrower in practice (its examples are amnesty/settlement schemes: 'AMNESTY, 2026', 'VISHWAS, 2026') and MIB's is the general form. Mapped because EPFO's is a strict subset of the same instrument form -- the difference is subject matter, which the Subject facet already carries -- but the narrowing is recorded here so a reader is not surprised by what EPFO returns.",
    tags: { EPFO: "Scheme", MIB: "Scheme" },
  },
  {
    facet: "INSTRUMENT_TYPE",
    name: "Sector / National Policy Document",
    definition:
      "A standalone sector-wide or national policy text setting policy for a domain, as distinct from a gazette notification, a rule, or an internal memorandum.",
    notes:
      "PARTIAL BY DESIGN. CLC also has a tag literally named 'Policy' and it is deliberately NOT mapped here -- CLC's is 'an internal administrative policy document, e.g. Transfer Policy', an HR instrument, not a sector policy. See the false-cognate finding for 'Policy'.",
    tags: { "DOS-ISRO": "Policy", DST: "Policy Document", MIB: "Policy" },
  },
  {
    facet: "INSTRUMENT_TYPE",
    name: "Subordinate Legislation (Rules made under an Act)",
    definition:
      "Delegated legislation made under a primary Act -- statutory Rules with the force of law.",
    notes:
      "PARTIAL BY DESIGN, and the most important partial mapping in this table. Six regulators have a tag named exactly 'Rules', but only these four define it as Act-derived delegated legislation. EPFO's 'Rules' is 'draft or notified recruitment/service rules' -- internal HR rules, not delegated legislation -- and CLC's spans both ('rules notified under a labour Act, OR internal service rules'). Both are left unmapped. See the false-cognate finding for 'Rules'.",
    tags: { DOT: "Rules", FIU: "Rules", MIB: "Rules", MTCTE: "Rules" },
  },
  {
    facet: "INSTRUMENT_TYPE",
    name: "Enforcement / Adjudicatory Order",
    definition:
      "An adjudicatory order passed by the regulator itself that determines liability and/or imposes a monetary penalty or sanction on a named party.",
    notes:
      "The near-duplicate the audit set out to find, and it is genuine: FIU's own seeded definition names the equivalence ('FIU-IND's core enforcement output', and its matching Subject tag says 'structurally the closest equivalent to a CCI Order'). CCI's is Section 26(1)/26(2)/27/31/43A/44 of the Competition Act; FIU's is Section 13 PMLA. ONLY these two. The generic 'Order' tag at CLC, DOT, ESIC, MIB and SARALSANCHAR is an administrative directive, NOT an adjudicatory order, and is deliberately excluded -- see the false-cognate finding for 'Order'. No CERC, APTEL, IRDAI or SEBI regulator exists in this database, so no equivalent could be checked for them.",
    tags: { CCI: "CCI Order", FIU: "Adjudication / Penalty Order" },
  },
];

// ---------------------------------------------------------------------------
// SUBJECT
// ---------------------------------------------------------------------------

const SUBJECT: ConceptDef[] = [
  {
    facet: "SUBJECT",
    name: "Institutional Governance & Administration",
    definition:
      "The institution's own internal governance and administrative matters -- leadership appointments, organisational structure, and internal directives not tied to any specific regulated function.",
    notes:
      "Nine regulators, and the definitions are near-verbatim identical ('X's own internal/administrative matters, not tied to a specific ... function'). DOT's tag is named 'Governance and Rulemaking' but its definition is the same internal-administration scope, so it maps. MTCTE's identically-named 'Governance and Rulemaking' does NOT map: its definition is a mixed bucket of scheme/fee administration, meeting logistics, product-lifecycle clarifications AND DoT-level legislative Rules. See the false-cognate finding for 'Governance and Rulemaking'.",
    tags: {
      CCI: "Institutional Governance & Administration",
      "DOS-ISRO": "Institutional Governance & Administration",
      FIU: "Institutional Governance & Administration",
      CLC: "Governance and Administration",
      DST: "Governance and Administration",
      EPFO: "Governance and Administration",
      ESIC: "Governance and Administration",
      SARALSANCHAR: "Governance and Administration",
      DOT: "Governance and Rulemaking",
    },
  },
  {
    facet: "SUBJECT",
    name: "Personnel / Establishment Matters",
    definition:
      "Routine internal HR and establishment business -- transfers, postings, promotions, seniority and gradation lists, probation and APAR, and recruitment/service rules for the institution's own staff.",
    notes:
      "The first four are child tags under each regulator's governance parent, with materially identical definitions. MIB's flat 'Ministry Internal Administration (HR/Recruitment/Establishment)' is a near-duplicate covering the same ground plus committee constitution and delegation of powers. DST's 'Service Conditions & Recruitment Rules' is deliberately NOT mapped: its definition scopes it to the rules and OMs governing service conditions and is explicitly 'distinct from one-off vacancy advertisements', making it a rules-about-HR subject rather than the routine HR-events bucket.",
    tags: {
      CLC: "Governance and Administration > Personnel/Establishment",
      EPFO: "Governance and Administration > Personnel/Establishment",
      ESIC: "Governance and Administration > Personnel/Establishment",
      DOT: "Governance and Rulemaking > Personnel/Administration",
      MIB: "Ministry Internal Administration (HR/Recruitment/Establishment)",
    },
  },
  {
    facet: "SUBJECT",
    name: "Official Language (Rajbhasha)",
    definition:
      "Hindi-language promotion and Official Language implementation -- Hindi Diwas/Pakhwada, Rajbhasha committee matters, and Hindi implementation directives.",
    tags: {
      EPFO: "Governance and Administration > Official Language (Rajbhasha)",
      ESIC: "Governance and Administration > Official Language (Rajbhasha)",
    },
  },
  {
    facet: "SUBJECT",
    name: "International Cooperation",
    definition:
      "The institution's own bilateral and multilateral cooperation with foreign counterpart authorities and international bodies -- MoUs, joint working groups, treaty coordination, and international standard-setting participation.",
    notes:
      "FIU's 'International Cooperation & FATF Compliance' is a near-duplicate that adds an FATF standards-compliance element to the same institutional-cooperation core. Three regulators have international-sounding Subjects that are deliberately NOT mapped, because in each case the subject is substantive sector regulation rather than institutional cooperation: MIB's 'International Co-production Agreements' (audio-visual co-production treaties -- a film-sector regime), EPFO's 'International Social Security Agreements' (benefit portability -- a substantive social-security regime), and DST's 'Funding Calls & Proposals (Bilateral/International)' (funding calls, not cooperation instruments).",
    tags: {
      CCI: "International Cooperation",
      "DOS-ISRO": "International Cooperation",
      DOT: "International Cooperation",
      FIU: "International Cooperation & FATF Compliance",
    },
  },
  {
    facet: "SUBJECT",
    name: "Public Information & Transparency (RTI)",
    definition:
      "RTI disclosures and public-transparency material published under the Right to Information Act.",
    tags: {
      CCI: "Public Information & Transparency",
      "DOS-ISRO": "Public Information & Transparency",
      FIU: "Public Information & Transparency",
    },
  },
  {
    facet: "SUBJECT",
    name: "Procurement & Tenders",
    definition:
      "The institution's procurement of goods, works, and services -- tenders, RFPs, rate contracts, bid invitations, and professional empanelment for procurement purposes.",
    notes:
      "CCI is deliberately NOT mapped even though it has procurement content, because its 'Recruitment, Procurement & Institutional Opportunities' is a single merged Subject covering BOTH procurement and staffing. Mapping it here would silently pull CCI's job vacancies into a procurement query. FIU's own seeded definition documents this exact divergence as a deliberate design decision made after a live pipeline run. ESIC's 'Litigation Management & Legal Empanelment' is also excluded: its empanelment is advocate-panel management under a litigation-policy subject, not procurement.",
    tags: {
      "DOS-ISRO": "Procurement & Tenders",
      FIU: "Procurement & Tenders",
      EPFO: "Governance and Administration > Empanelment & Procurement",
      ESIC: "Procurement & Rate Contracts",
    },
  },
];

// ---------------------------------------------------------------------------
// STATUS
// ---------------------------------------------------------------------------

const STATUS: ConceptDef[] = [
  {
    facet: "STATUS",
    name: "In Force",
    definition: "The instrument is the current, legally or administratively operative version.",
    notes:
      "All 11 regulators, exact name match, and 9 of 11 definitions are verbatim identical. The two that differ (DOS-ISRO, FIU) only append regulator-specific examples to the same rule. ONE ASYMMETRY WORTH KNOWING: DST is the only regulator that scopes this value via statusAppliesToSubjectIds -- its 'In Force' is valid for only 6 of its 9 Subjects, and is a category error on its three Funding Calls Subjects, which use Open/Closed/Results Announced instead. Everywhere else 'In Force' applies to every Subject. The concept is the same; DST's applicability is narrower.",
    tags: Object.fromEntries(ALL_11.map((r) => [r, "In Force"])),
  },
  {
    facet: "STATUS",
    name: "Amended",
    definition:
      "The base instrument remains in force but has been modified by a subsequent amending document.",
    notes:
      "All 11 regulators, exact name match, definitions materially identical. As with 'In Force', DST scopes this to 6 of its 9 Subjects via statusAppliesToSubjectIds; every other regulator applies it to all Subjects.",
    tags: Object.fromEntries(ALL_11.map((r) => [r, "Amended"])),
  },
  {
    facet: "STATUS",
    name: "Draft / Under Consultation",
    definition: "Published for stakeholder comment or otherwise unfinalised; not yet operative.",
    notes:
      "All 11 regulators, exact name match. DOS-ISRO and FIU add the same negative carve-out (not for outreach/press content), which narrows application but not the concept. DST again scopes this to 6 of its 9 Subjects.",
    tags: Object.fromEntries(ALL_11.map((r) => [r, "Draft / Under Consultation"])),
  },
  {
    facet: "STATUS",
    name: "Superseded",
    definition: "The instrument has been fully replaced by a later version of the same instrument.",
    notes:
      "Only the four regulators that distinguish supersession from repeal. The other seven use a single combined tag -- mapped to its own concept below rather than forced in here. DST scopes its 'Superseded' to 6 of its 9 Subjects.",
    tags: { CCI: "Superseded", "DOS-ISRO": "Superseded", DST: "Superseded", FIU: "Superseded" },
  },
  {
    facet: "STATUS",
    name: "Repealed",
    definition:
      "The instrument has been formally withdrawn without a direct like-for-like successor.",
    notes:
      "Same four-versus-seven split as 'Superseded'; CCI, DOS-ISRO and FIU carry this as a distinct value.",
    tags: { CCI: "Repealed", "DOS-ISRO": "Repealed", FIU: "Repealed" },
  },
  {
    facet: "STATUS",
    name: "Superseded / Repealed (combined)",
    definition:
      "A later instrument has formally replaced this one, or it has been withdrawn; it is no longer operative. This is deliberately the UNION of the separate 'Superseded' and 'Repealed' concepts, used by the seven regulators whose taxonomies do not draw that distinction.",
    notes:
      "Kept as its own concept rather than merged into 'Superseded' or 'Repealed' precisely because it is coarser. Merging would tell a reader that CLC's 17 'Superseded / Repealed' documents are all supersessions, which the data does not say. A cross-regulator 'no longer operative' query should union all three of these concepts.",
    tags: {
      CLC: "Superseded / Repealed",
      DOT: "Superseded / Repealed",
      EPFO: "Superseded / Repealed",
      ESIC: "Superseded / Repealed",
      MIB: "Superseded / Repealed",
      MTCTE: "Superseded / Repealed",
      SARALSANCHAR: "Superseded / Repealed",
    },
  },
  {
    facet: "STATUS",
    name: "Not Applicable",
    definition:
      "The Status facet does not meaningfully describe this content -- outreach, education, and event material that is not itself a regulatory instrument with a lifecycle.",
    notes:
      "FIU's seeded definition records that it was 'adopted directly from CCI's v1.3 correction', which is direct evidence of a deliberate shared concept rather than coincidence. Application guidance does differ at the edges and is worth knowing: CCI explicitly excludes tenders, RFPs and market studies from this value, while FIU explicitly includes its own Annual Report. The concept is the same; the boundary each regulator draws is not identical.",
    tags: { CCI: "Not Applicable", "DOS-ISRO": "Not Applicable", FIU: "Not Applicable" },
  },
  {
    facet: "STATUS",
    name: "Under Litigation / Stayed",
    definition:
      "The instrument's or order's validity is subject to an ongoing appeal or has been stayed by a tribunal or court.",
    notes:
      "FIU's seeded definition states the borrowing outright: 'Naming reused from CCI's identical Status tag for cross-regulator consistency.' CCI's route is NCLAT/Supreme Court, FIU's is the Section 26 PMLA Appellate Tribunal.",
    tags: { CCI: "Under Litigation / Stayed", FIU: "Under Litigation / Stayed" },
  },
];

export const CANONICAL_CONCEPTS: ConceptDef[] = [...SUBJECT, ...INSTRUMENT_TYPE, ...STATUS];

// ---------------------------------------------------------------------------
// FALSE COGNATES -- names that recur across regulators but do NOT share a
// concept. These are recorded so the decision is reviewable, and so nobody
// later "completes" the mapping by linking them. NONE of these get a
// CanonicalConcept row.
// ---------------------------------------------------------------------------

export interface FalseCognate {
  facet: Facet;
  tagName: string;
  /** Why the name match is not a concept match. */
  verdict: string;
  /** Label (regulator + disposition) -> that regulator's real seeded definition text. */
  definitions: Record<string, string>;
}

export const FALSE_COGNATES: FalseCognate[] = [
  {
    facet: "INSTRUMENT_TYPE",
    tagName: "Notification",
    verdict:
      "Five regulators use this exact name for five materially different instruments. CCI's is a Gazette/CCI notification sitting alongside a SEPARATE 'Regulation' tag. FIU's is issued by the Ministry, not by FIU-IND at all, and designates reporting-entity scope. MTCTE's deliberately absorbs the entire exemption/relaxation filing family and is its single dominant instrument type (94 of 151 real entries). EPFO's and ESIC's are generic administrative notifications. A shared concept would put a Ministry designation order, a CCI gazette notice and 94 MTCTE product-exemption filings in one bucket. Not mapped. Note also that DOS-ISRO, MIB and SARALSANCHAR each fold a different second instrument into the name, compounding the divergence.",
    definitions: {
      CCI: "A formal Gazette or CCI notification.",
      EPFO: "A formal notification, e.g. of Authorised Officers under the Code on Social Security.",
      ESIC: "A formal notification.",
      FIU: "A Ministry (not FIU-IND itself) notification, typically designating a new category of entity as a 'reporting entity' under the Act.",
      MTCTE:
        "A formal MTCTE notification -- phase launches, product coverage, and (deliberately) the exemption/relaxation filing family, per this file's own note above.",
      "DOS-ISRO (as 'Notification / Circular')":
        "Administrative notifications and circulars that do not themselves promulgate a Policy, NGP, or Authorization -- corrigenda, procedural updates, individual exemption notices.",
      "MIB (as 'Notification / Notice')": "A gazette notification or public notice.",
      "SARALSANCHAR (as 'Notifications')":
        "A formal notification, e.g. bringing specific sections of an Act into force, or notifying a new rule/scheme.",
    },
  },
  {
    facet: "INSTRUMENT_TYPE",
    tagName: "Order",
    verdict:
      "The single most consequential false cognate found, because it collides with a genuine near-duplicate. At CCI and FIU an order is ADJUDICATORY -- it determines liability and imposes a penalty ('CCI Order', 'Adjudication / Penalty Order'), and those two ARE mapped together as 'Enforcement / Adjudicatory Order'. At CLC, DOT, ESIC, MIB and SARALSANCHAR a plain 'Order' is an ADMINISTRATIVE DIRECTIVE -- transfer and posting orders, a state RoW implementation order, a VDA wage order. DOT's 393 'Order' entries are overwhelmingly routine administration. Mapping 'Order' into the enforcement concept on the strength of the name would swamp a cross-regulator enforcement search with HR paperwork. The five administrative 'Order' tags are also not mapped to each other: their scopes differ among themselves, since ESIC and EPFO route internal directives to a separate 'Office Order' tag while DOT routes them into 'Order'.",
    definitions: {
      CLC: "A directive order, e.g. a VDA Order.",
      DOT: "A directive order, e.g. transfer/posting orders, blocking-notification orders.",
      ESIC: "A directive order not otherwise numbered as an Office Order.",
      MIB: "A formal order or direction.",
      "SARALSANCHAR (as 'Orders')":
        "A directive order, most commonly a state government's order implementing a central RoW policy, or a DoT/nodal-wing administrative order.",
      "CCI (as 'CCI Order') -- MAPPED to Enforcement / Adjudicatory Order":
        "An adjudicatory order passed by the Commission, e.g. under Section 26(1)/26(2)/27/31/43A/44.",
      "FIU (as 'Adjudication / Penalty Order') -- MAPPED to Enforcement / Adjudicatory Order":
        "A real, operative order by the Director FIU-IND under Section 13 PMLA imposing a monetary penalty or other sanction on a named reporting entity -- FIU-IND's core enforcement output.",
    },
  },
  {
    facet: "INSTRUMENT_TYPE",
    tagName: "Rules",
    verdict:
      "Six regulators share this exact name, but two mean something different in kind. DOT, FIU, MIB and MTCTE all define it as delegated legislation made under a primary Act -- these four ARE mapped to 'Subordinate Legislation (Rules made under an Act)'. EPFO's is 'draft or notified recruitment/service rules', which is internal HR policy with no statutory character. CLC's spans both in a single tag ('rules notified under a labour Act, OR internal service rules'), so it cannot be mapped without importing HR content into a statutory-instrument query. EPFO and CLC are left unmapped.",
    definitions: {
      "DOT -- MAPPED":
        "Rules notified under the Telecommunications Act 2023 or its predecessor framework, e.g. '...Rules, 2026'.",
      "FIU -- MAPPED":
        "Delegated legislation made under the Act -- chiefly the Prevention of Money-Laundering (Maintenance of Records) Rules, 2005.",
      "MIB -- MAPPED": "Statutory rules made under an Act.",
      "MTCTE -- MAPPED":
        "Legislative Rules (Act-derived), as distinct from MTCTE's own internal Procedure document.",
      "EPFO -- NOT mapped": "Draft or notified recruitment/service rules.",
      "CLC -- NOT mapped": "Rules notified under a labour Act, or internal service rules.",
    },
  },
  {
    facet: "INSTRUMENT_TYPE",
    tagName: "Policy",
    verdict:
      "CLC's 'Policy' is an internal HR instrument; DOS-ISRO's and MIB's are sector-level policy texts. These are different instruments that happen to share a word. DOS-ISRO, MIB and DST's 'Policy Document' ARE mapped together as 'Sector / National Policy Document'; CLC is not.",
    definitions: {
      "CLC -- NOT mapped": "An internal administrative policy document, e.g. Transfer Policy.",
      "DOS-ISRO -- MAPPED":
        "A Cabinet- or DOS-level policy document setting sector-wide or domain-specific rules (Indian Space Policy 2023, Remote Sensing Data Policy, Spacecom Policy).",
      "MIB -- MAPPED": "A stated policy document.",
      "DST (as 'Policy Document') -- MAPPED":
        "A standalone national policy text, distinct from a gazette notification or an OM.",
    },
  },
  {
    facet: "SUBJECT",
    tagName: "Governance and Rulemaking",
    verdict:
      "DOT and MTCTE use the identical Subject name for different scopes. DOT's is purely the institution's own internal administration, which matches the nine-regulator 'Institutional Governance & Administration' concept, and IS mapped to it. MTCTE's is a mixed residual bucket -- scheme and fee administration, meeting logistics, product end-of-life clarifications, and DoT-level legislative Rules that appear on MTCTE's own site. Mapping MTCTE here would pull statutory Rules content into an internal-administration query, so MTCTE is left unmapped.",
    definitions: {
      "DOT -- MAPPED to Institutional Governance & Administration":
        "DoT's own internal/administrative matters not tied to a specific regulated sector.",
      "MTCTE -- NOT mapped":
        "Scheme/fee administration, meeting logistics, product-lifecycle (EoL/EoS) clarifications, and DoT-level legislative Rules referenced on MTCTE's own site.",
    },
  },
  {
    facet: "SUBJECT",
    tagName: "Procurement (merged vs. split subjects)",
    verdict:
      "Not a shared name, but the same failure mode and worth recording alongside the others. CCI folds procurement and staffing into ONE Subject ('Recruitment, Procurement & Institutional Opportunities'), while FIU deliberately splits them into two. FIU's own seeded definition documents the split as a decision taken after a live pipeline run. CCI is therefore left unmapped for 'Procurement & Tenders': linking it would silently return CCI job vacancies to anyone filtering for procurement across regulators.",
    definitions: {
      "CCI (as 'Recruitment, Procurement & Institutional Opportunities') -- NOT mapped":
        "Job vacancies, deputation postings, internship calls, tenders, RFPs, and empanelment notices issued by CCI.",
      "DOS-ISRO -- MAPPED":
        "Tenders, RFPs, and corrigenda issued by ISRO Centres and NSIL for goods, works, and services -- administrative/commercial, not rulemaking, structurally the same role as CCI's Tenders feed.",
      "FIU (as 'Procurement & Tenders') -- MAPPED":
        "Tenders and RFPs issued by FIU-IND for goods, works, and services.",
      "FIU (as 'Recruitment & Institutional Opportunities') -- separate Subject, NOT mapped to procurement":
        "Job vacancies, deputation postings, and contractual staff/consultant engagement notices issued by FIU-IND -- kept as its own Subject rather than folded into Institutional Governance & Administration or merged into Procurement & Tenders (unlike CCI's equivalent combined Subject).",
    },
  },
  {
    facet: "SUBJECT",
    tagName: "International Cooperation (sector regimes sharing the word)",
    verdict:
      "CCI, DOS-ISRO, DOT and FIU all use this Subject for institutional cooperation with foreign counterparts, and those four ARE mapped. Three other regulators have international-sounding Subjects that are substantive sector regulation, not cooperation, and are deliberately not mapped -- treating them as the same concept would put film co-production treaties and social-security benefit portability into an institutional-cooperation query.",
    definitions: {
      "CCI -- MAPPED":
        "CCI's bilateral and multilateral cooperation with foreign competition authorities and international bodies.",
      "DOS-ISRO -- MAPPED":
        "MoUs, joint working groups, and cooperation agreements with foreign space agencies and international bodies.",
      "DOT -- MAPPED": "ITU, APT, and other international treaty/coordination matters.",
      "FIU (as 'International Cooperation & FATF Compliance') -- MAPPED":
        "FIU-IND's role in India's compliance with Financial Action Task Force (FATF) recommendations and cooperation with foreign financial intelligence units (the Egmont Group).",
      "MIB (as 'International Co-production Agreements') -- NOT mapped":
        "Bilateral audio-visual co-production treaties and agreements between India and foreign governments.",
      "EPFO (as 'International Social Security Agreements') -- NOT mapped":
        "Bilateral social security / totalization agreements between India and other countries.",
      "DST (as 'Funding Calls & Proposals (Bilateral/International)') -- NOT mapped":
        "Calls for joint research proposals under DST's bilateral and multilateral STI cooperation agreements, administered by the International Cooperation Division (mostly hosted on aistic.gov.in).",
    },
  },
];
