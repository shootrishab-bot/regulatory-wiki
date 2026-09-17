import type { Level } from "@/components/ans/ui";

/**
 * Fixtures for the ANS / Horizon Scan demo.
 *
 * Every client, matter, partner and judgment below is invented. The
 * regulators, source pages and instrument names are real, because those are
 * the ones the scrapers in /scrapers already cover and the ones the firm will
 * recognise on screen. Nothing here touches Postgres: the Horizon Scan tabs
 * have to render identically on a laptop with no database, which is how the
 * demo is given. The real, ingested corpus stays behind the "Regulatory
 * library" tab and is still served from lib/queries.ts.
 */

export const LAST_REFRESHED = "today, 06:00 IST";

/** Deliberately a role, not a person: the demo is given by whoever is in the room. */
export const CURRENT_USER = {
  initials: "A",
  name: "Associate",
  role: "Legal Technology",
  team: "Corporate",
  email: "associate@trilegal.com",
};

export const FIRM = {
  code: "DIG",
  name: "Digital Innovations Group",
};

/* ------------------------------------------------------------------ */
/* Regulators and their source pages                                   */
/* ------------------------------------------------------------------ */

export interface RegulatorSource {
  code: string;
  name: string;
  /** Shown under the name where the entry is a bundle of portals. */
  subtitle?: string;
  sources: string[];
  selected: boolean;
  /** Starts open, the way MeitY does in the mockup. */
  expanded?: boolean;
}

export const REGULATORS: RegulatorSource[] = [
  {
    code: "TRAI",
    name: "Telecom Regulatory Authority of India",
    sources: [
      "Regulations",
      "Consultation papers",
      "Recommendations",
      "Press releases",
      "Tariff orders",
    ],
    selected: true,
  },
  {
    code: "DoT",
    name: "Department of Telecommunications",
    sources: ["Circulars", "Licensing", "Public notices"],
    selected: false,
  },
  {
    code: "DoT Portals",
    name: "Ministry of Communications portals",
    subtitle: "MTCTE · Saras · Saral Sanchar",
    sources: ["MTCTE notices", "Saras updates", "Saral Sanchar circulars"],
    selected: false,
  },
  {
    code: "ISRO",
    name: "Indian Space Research Organisation",
    sources: ["Announcements"],
    selected: false,
  },
  {
    code: "MoHFW",
    name: "Ministry of Health and Family Welfare",
    sources: ["Notifications"],
    selected: false,
  },
  {
    code: "DRDO",
    name: "Defence Research and Development Organisation",
    sources: ["Notices"],
    selected: false,
  },
  {
    code: "MeitY",
    name: "Ministry of Electronics and Information Technology",
    sources: [
      "What's New",
      "Documents",
      "Acts and policies",
      "Orders and notices",
      "Publications",
      "Press releases",
      "Gazette notifications",
      "Guidelines",
    ],
    selected: true,
    expanded: true,
  },
  {
    code: "CERT-In",
    name: "Indian Computer Emergency Response Team",
    sources: ["Home page updates"],
    selected: true,
  },
  {
    code: "RBI",
    name: "Reserve Bank of India",
    sources: ["Master directions", "Circulars", "Press releases", "Notifications"],
    selected: true,
  },
  {
    code: "UIDAI",
    name: "Unique Identification Authority of India",
    sources: ["Regulations", "Circulars", "Office memoranda"],
    selected: true,
  },
  {
    code: "MIB",
    name: "Ministry of Information and Broadcasting",
    sources: ["Uplinking and downlinking", "Advisories", "Public notices"],
    selected: false,
  },
  {
    code: "IN-SPACe",
    name: "Indian National Space Promotion and Authorisation Centre",
    sources: ["Authorisation norms", "Guidelines"],
    selected: false,
  },
];

/** Matches the mockup's footnote: 21 sources across 5 selected regulators. */
export const SUBSCRIPTION_SUMMARY = {
  sources: REGULATORS.filter((r) => r.selected).reduce((n, r) => n + r.sources.length, 0),
  regulators: REGULATORS.filter((r) => r.selected).length,
};

/* ------------------------------------------------------------------ */
/* Alerts                                                              */
/* ------------------------------------------------------------------ */

export interface Alert {
  id: string;
  level: Level;
  title: string;
  source: string;
  when: string;
  body: string;
}

export const RECENT_ALERTS: Alert[] = [
  {
    id: "dpdp-rule-3",
    level: "red",
    title: "DPDP Rules, 2025 — Rule 3 notice requirements in force",
    source: "MeitY · Gazette notifications",
    when: "Today, 06:04",
    body: "Affects 9 open matters. Three are already in the scanning queue with drafts prepared.",
  },
  {
    id: "trai-network-authorisation",
    level: "amber",
    title: "Consultation paper on network authorisation framework",
    source: "TRAI · Consultation",
    when: "Yesterday, 18:20",
    body: "Comments due 10 October 2026. Two clients have previously filed submissions on the predecessor consultation.",
  },
  {
    id: "rbi-payment-data",
    level: "amber",
    title: "Master Direction on payment system data — updated",
    source: "RBI · Master directions",
    when: "9 Sep, 11:02",
    body: "Consolidates the 2018 storage direction and clarifies the position for data processed abroad for analytics.",
  },
  {
    id: "meity-deepfake",
    level: "info",
    title: "Advisory on deepfake labelling for intermediaries",
    source: "MeitY · Orders and notices",
    when: "5 Sep, 15:47",
    body: "Advisory only. No compliance date stated.",
  },
  {
    id: "certin-breach-window",
    level: "amber",
    title: "CERT-In FAQ revised on the six-hour reporting window",
    source: "CERT-In · Home page updates",
    when: "2 Sep, 09:15",
    body: "Reworded to align with the DPDP breach intimation. Two clients run a single incident runbook against both.",
  },
  {
    id: "uidai-auth",
    level: "info",
    title: "Aadhaar authentication — revised onboarding checklist for AUAs",
    source: "UIDAI · Circulars",
    when: "28 Aug, 12:30",
    body: "Checklist only. No change to the underlying regulations.",
  },
];

export const FREQUENCY_OPTIONS = [
  { value: "realtime", label: "Real time", hint: "Sent within minutes of publication." },
  {
    value: "daily",
    label: "Daily digest, 07:00 IST",
    hint: "One email grouping everything published overnight.",
  },
  {
    value: "weekly",
    label: "Weekly digest, Monday",
    hint: "For sources that publish rarely.",
  },
  {
    value: "split",
    label: "Real time for binding instruments, daily for the rest",
    hint: "Recommended.",
  },
];

export const SIGNIFICANCE_OPTIONS = [
  "Binding instruments and consultations",
  "Binding instruments only",
  "Everything, including press releases",
  "Anything tagged to an open matter",
];

/* ------------------------------------------------------------------ */
/* Newsletters                                                         */
/* ------------------------------------------------------------------ */

export interface NewsletterTopic {
  id: string;
  title: string;
  sources: string;
  matters: number;
  selected: boolean;
}

export interface Subscriber {
  id: string;
  name: string;
  role: string;
  email: string;
  selected: boolean;
  status: "primary" | "consented" | "pending";
}

export interface Newsletter {
  id: string;
  client: string;
  cadence: string;
  cadenceSetting: string;
  signedOffBy: string;
  mattersSince: string;
  topics: NewsletterTopic[];
  subscribers: Subscriber[];
  preview: { subject: string; intro: string; items: { title: string; body: string }[] };
}

export const NEWSLETTERS: Newsletter[] = [
  {
    id: "helios-payments",
    client: "Helios Payments Pvt Ltd",
    cadence: "Monthly · 5 topics · 3 subscribers · next 6 Oct",
    cadenceSetting: "Monthly — first Tuesday",
    signedOffBy: "R. Iyer — Partner, TMT",
    mattersSince: "11 matters opened for this client since 2023",
    topics: [
      {
        id: "dpdp",
        title: "Data protection — DPDP Act and Rules",
        sources: "MeitY · CERT-In · UIDAI",
        matters: 9,
        selected: true,
      },
      {
        id: "payments",
        title: "Payments and digital lending",
        sources: "RBI · NPCI · Bharat Connect",
        matters: 6,
        selected: true,
      },
      {
        id: "incident",
        title: "Cyber incident reporting",
        sources: "CERT-In · RBI",
        matters: 4,
        selected: true,
      },
      {
        id: "crossborder",
        title: "Cross-border transfer and localisation",
        sources: "MeitY · RBI",
        matters: 3,
        selected: true,
      },
      {
        id: "darkpatterns",
        title: "Consumer protection and dark patterns",
        sources: "DoCA · CCPA",
        matters: 2,
        selected: true,
      },
      {
        id: "telecom",
        title: "Telecom authorisations",
        sources: "TRAI · DoT",
        matters: 1,
        selected: false,
      },
    ],
    subscribers: [
      {
        id: "rohan",
        name: "Rohan Desai",
        role: "General Counsel",
        email: "rohan.desai@heliospay.in",
        selected: true,
        status: "primary",
      },
      {
        id: "ananya",
        name: "Ananya Rao",
        role: "Head of Compliance",
        email: "ananya.rao@heliospay.in",
        selected: true,
        status: "consented",
      },
      {
        id: "vikram",
        name: "Vikram Shah",
        role: "Chief Technology Officer",
        email: "vikram.shah@heliospay.in",
        selected: true,
        status: "consented",
      },
      {
        id: "priya",
        name: "Priya Menon",
        role: "Company Secretary",
        email: "priya.menon@heliospay.in",
        selected: false,
        status: "consented",
      },
      {
        id: "karthik",
        name: "Karthik Iyer",
        role: "Head of Product",
        email: "karthik.iyer@heliospay.in",
        selected: false,
        status: "pending",
      },
    ],
    preview: {
      subject: "Helios Payments — regulatory update, September 2026",
      intro:
        "Five developments this month touch positions we have advised on. Two of them need a decision before the end of October.",
      items: [
        {
          title: "DPDP Rules, 2025 — notice and consent",
          body: "Rule 3 is now in force. The layered notice recommended in our June 2024 advice will not satisfy the itemisation requirement without redrafting.",
        },
        {
          title: "Payment system data — consolidated Master Direction",
          body: "The Reserve Bank has folded the 2018 storage direction into a single instrument and clarified processing abroad for analytics.",
        },
        {
          title: "Cyber incident reporting",
          body: "CERT-In's revised FAQ narrows the six-hour clock. A single runbook now has two different triggers to satisfy.",
        },
      ],
    },
  },
  {
    id: "northwind",
    client: "Northwind Broadcasting Ltd",
    cadence: "Fortnightly · 3 topics · 6 subscribers · next 22 Sep",
    cadenceSetting: "Fortnightly — Monday",
    signedOffBy: "A. Menon — Partner, Media",
    mattersSince: "7 matters opened for this client since 2023",
    topics: [
      {
        id: "uplinking",
        title: "Uplinking and downlinking guidelines",
        sources: "MIB",
        matters: 5,
        selected: true,
      },
      {
        id: "spectrum",
        title: "Satellite spectrum and authorisations",
        sources: "TRAI · DoT · IN-SPACe",
        matters: 4,
        selected: true,
      },
      {
        id: "content",
        title: "Content codes and advisories",
        sources: "MIB · MeitY",
        matters: 3,
        selected: true,
      },
    ],
    subscribers: [
      {
        id: "n1",
        name: "Meera Krishnan",
        role: "General Counsel",
        email: "meera.k@northwind.tv",
        selected: true,
        status: "primary",
      },
      {
        id: "n2",
        name: "Farhan Qureshi",
        role: "Head of Regulatory Affairs",
        email: "farhan.q@northwind.tv",
        selected: true,
        status: "consented",
      },
      {
        id: "n3",
        name: "Sneha Pillai",
        role: "Company Secretary",
        email: "sneha.p@northwind.tv",
        selected: true,
        status: "consented",
      },
    ],
    preview: {
      subject: "Northwind Broadcasting — regulatory update, 22 September 2026",
      intro:
        "The revised uplinking guidelines and two clarificatory notices change the assumptions behind the renewal strategy.",
      items: [
        {
          title: "Uplinking guidelines revised",
          body: "The renewal strategy in the March 2025 note assumes the earlier position on transfer of control.",
        },
        {
          title: "Subscriber-facing consent notice",
          body: "The same Rule 3 redraft that applies across the data protection matters applies to the OTT platform notice.",
        },
      ],
    },
  },
  {
    id: "ashvin",
    client: "Ashvin Insurance",
    cadence: "Quarterly · 2 topics · 4 subscribers · next 1 Oct",
    cadenceSetting: "Quarterly — first business day",
    signedOffBy: "S. Nair — Partner, Financial Regulatory",
    mattersSince: "5 matters opened for this client since 2024",
    topics: [
      {
        id: "irdai",
        title: "Insurance distribution and outsourcing",
        sources: "IRDAI",
        matters: 4,
        selected: true,
      },
      {
        id: "health",
        title: "Health data and claims",
        sources: "MoHFW · MeitY",
        matters: 2,
        selected: true,
      },
    ],
    subscribers: [
      {
        id: "a1",
        name: "Deepak Varma",
        role: "Chief Compliance Officer",
        email: "deepak.varma@ashvin.co.in",
        selected: true,
        status: "primary",
      },
      {
        id: "a2",
        name: "Ritu Bansal",
        role: "Head of Legal",
        email: "ritu.bansal@ashvin.co.in",
        selected: true,
        status: "consented",
      },
    ],
    preview: {
      subject: "Ashvin Insurance — regulatory update, Q3 2026",
      intro: "Two developments this quarter, neither of them urgent.",
      items: [
        {
          title: "Health data handling",
          body: "The DPDP Rules treat claims data processed for underwriting differently from data held for grievance handling.",
        },
      ],
    },
  },
  {
    id: "meridian",
    client: "Meridian Retail",
    cadence: "On material change · 4 topics · 5 subscribers",
    cadenceSetting: "On material change only",
    signedOffBy: "R. Iyer — Partner, TMT",
    mattersSince: "9 matters opened for this client since 2022",
    topics: [
      {
        id: "ecommerce",
        title: "E-commerce and consumer rules",
        sources: "DoCA · CCPA",
        matters: 6,
        selected: true,
      },
      {
        id: "dpdp-retail",
        title: "Customer data and loyalty programmes",
        sources: "MeitY",
        matters: 4,
        selected: true,
      },
      {
        id: "packaging",
        title: "Labelling and packaging",
        sources: "Legal Metrology · FSSAI",
        matters: 3,
        selected: true,
      },
      {
        id: "ads",
        title: "Advertising standards",
        sources: "ASCI · CCPA",
        matters: 2,
        selected: false,
      },
    ],
    subscribers: [
      {
        id: "m1",
        name: "Tara Sundaram",
        role: "General Counsel",
        email: "tara.s@meridianretail.in",
        selected: true,
        status: "primary",
      },
      {
        id: "m2",
        name: "Imran Sheikh",
        role: "Head of Data",
        email: "imran.s@meridianretail.in",
        selected: false,
        status: "pending",
      },
    ],
    preview: {
      subject: "Meridian Retail — material regulatory change",
      intro: "Sent only when something changes a position we have advised on.",
      items: [
        {
          title: "Dark patterns guidelines",
          body: "The CCPA's enforcement note names two interface patterns the loyalty sign-up flow currently uses.",
        },
      ],
    },
  },
];

export const CADENCE_OPTIONS = [
  "Monthly — first Tuesday",
  "Fortnightly — Monday",
  "Quarterly — first business day",
  "On material change only",
  "Weekly — Friday",
];

export const SIGNATORY_OPTIONS = [
  "R. Iyer — Partner, TMT",
  "A. Menon — Partner, Media",
  "S. Nair — Partner, Financial Regulatory",
  "K. Rao — Partner, Space and Defence",
  "Associate — Legal Technology",
];

/* ------------------------------------------------------------------ */
/* Matter scanning                                                     */
/* ------------------------------------------------------------------ */

export interface QueueItem {
  id: string;
  level: Level;
  client: string;
  matter: string;
  ref: string;
  partner: string;
  body: string;
  detected: string;
  counts: { red: number; amber: number };
}

export const SCAN_SUMMARY = {
  cadence: "Scanned nightly",
  openMatters: 214,
};

export const MATTER_QUEUE: QueueItem[] = [
  {
    id: "helios-dp-0417",
    level: "red",
    client: "Helios Payments Pvt Ltd",
    matter: "Data protection compliance review",
    ref: "2024/DP/0417",
    partner: "R. Iyer",
    body: "DPDP Rules, 2025 notified 13 November 2025. Five positions taken in the June 2024 advice are affected, two of them materially.",
    detected: "Detected today",
    counts: { red: 2, amber: 3 },
  },
  {
    id: "northwind-tmt-1188",
    level: "red",
    client: "Northwind Broadcasting Ltd",
    matter: "Uplinking licence renewal",
    ref: "2024/TMT/1188",
    partner: "A. Menon",
    body: "MIB has revised the uplinking guidelines and issued two clarificatory notices. The renewal strategy set out in the March 2025 note assumes the earlier position.",
    detected: "Detected 9 Sep 2026",
    counts: { red: 1, amber: 4 },
  },
  {
    id: "kavach-fin-0112",
    level: "amber",
    client: "Kavach Fintech",
    matter: "UPI arrangements",
    ref: "2026/FIN/0112",
    partner: "R. Iyer",
    body: "NPCI circular on third-party application provider market share, read with the RBI press release of 2 September 2026.",
    detected: "Detected 7 Sep 2026",
    counts: { red: 0, amber: 3 },
  },
  {
    id: "suryan-spc-0032",
    level: "amber",
    client: "Suryan Space Systems",
    matter: "Authorisation and spectrum",
    ref: "2025/SPC/0032",
    partner: "K. Rao",
    body: "IN-SPACe has published revised authorisation norms for non-geostationary constellations.",
    detected: "Detected 3 Sep 2026",
    counts: { red: 0, amber: 2 },
  },
];

export interface JudicialCase {
  name: string;
  court: string;
  body: string;
  weight: string;
  status: { label: string; tone: "green" | "amber" };
}

export interface Position {
  id: string;
  level: Level;
  title: string;
  source: string;
  matterPosition: { body: string; cite: string };
  currentPosition: { body: string; cite: string };
  judicial?: { summary: string; cases: JudicialCase[] };
  action?: string;
}

export interface MatterTest {
  id: string;
  client: string;
  matter: string;
  ref: string;
  partner: string;
  documents: string[];
  documentCount: number;
  lastFiled: string;
  comparedSince: string;
  comparedSinceOptions: string[];
  comparedSinceLabel: string;
  /** Documents beyond the ones chipped in the UI. */
  moreDocuments: number;
  regulatorsTested: number;
  positions: Position[];
}

export const MATTER_TEST: MatterTest = {
  id: "northwind-tmt-1188",
  client: "Northwind Broadcasting Ltd",
  matter: "Uplinking licence renewal",
  ref: "2024/TMT/1188",
  partner: "A. Menon",
  documents: [
    "Advisory note 14.06.2024",
    "Compliance gap assessment",
    "Cross-border memorandum",
    "Incident response review",
  ],
  documentCount: 11,
  lastFiled: "2 March 2025",
  moreDocuments: 2,
  comparedSince: "date of the matter advice (14 June 2024)",
  comparedSinceLabel: "14 June 2024",
  comparedSinceOptions: [
    "date of the matter advice (14 June 2024)",
    "last client update (2 March 2025)",
    "last 12 months",
    "last 90 days",
  ],
  regulatorsTested: 5,
  positions: [
    {
      id: "consent-notice",
      level: "red",
      title: "Consent notice architecture",
      source: "MeitY · Gazette notifications · DPDP Rules, 2025",
      matterPosition: {
        body: "The advice proceeded on the draft rules then in circulation and recommended a single layered notice, with itemised purposes to be settled once the rules were notified.",
        cite: "Data Protection Advisory Note, 14 June 2024, paragraphs 4.2–4.6",
      },
      currentPosition: {
        body: "Rule 3 prescribes the content of the notice in terms, including an itemised description of personal data, the specified purpose against each item, and the manner of withdrawal. A notice drafted to the draft-rule standard will not satisfy it.",
        cite: "DPDP Rules, 2025, Rule 3 · notified 13 November 2025",
      },
      judicial: {
        summary: "2 judgments and orders tagged to DPDP Rules, 2025 · Rule 3",
        cases: [
          {
            name: "Vaidyanathan v. Union of India",
            court: "High Court of Karnataka · W.P. 14882 of 2026",
            body: "The court read Rule 3 as requiring the itemisation to be legible in the notice itself, and declined to accept a hyperlinked schedule as compliance. The point was argued but not decided on whether a layered notice satisfies the rule where the first layer is complete.",
            weight: "Binding in Karnataka · persuasive elsewhere",
            status: { label: "Under appeal", tone: "amber" },
          },
          {
            name: "In re: Aarohi Health Technologies",
            court: "Data Protection Board · Order dated 4 July 2026",
            body: "Consent obtained on a pre-Rules notice was held not to carry forward. Fresh consent was directed within ninety days.",
            weight: "Persuasive · first order on the provision",
            status: { label: "Good law", tone: "green" },
          },
        ],
      },
      action:
        "Re-draft the customer-facing notice against Rule 3 and re-paper the in-product consent flow.",
    },
    {
      id: "children-consent",
      level: "red",
      title: "Verifiable consent for children",
      source: "MeitY · Acts and policies · DPDP Rules, 2025",
      matterPosition: {
        body: "The advice recorded that verifiable parental consent could be satisfied by a self-declaration of age at sign-up, pending the rules.",
        cite: "Data Protection Advisory Note, 14 June 2024, paragraph 6.1",
      },
      currentPosition: {
        body: "Rule 10 requires the data fiduciary to adopt reasonable measures to verify that the adult giving consent is identifiable, by reference to a virtual token or a voluntarily produced identity document. Self-declaration alone sits outside the rule.",
        cite: "DPDP Rules, 2025, Rule 10 · notified 13 November 2025",
      },
      judicial: {
        summary: "1 order tagged to DPDP Rules, 2025 · Rule 10",
        cases: [
          {
            name: "In re: Playloop Interactive",
            court: "Data Protection Board · Order dated 19 August 2026",
            body: "An age gate with no verification step was held insufficient where the service was directed at users under eighteen. A token-based check offered by the fiduciary mid-proceeding was accepted going forward.",
            weight: "Persuasive",
            status: { label: "Good law", tone: "green" },
          },
        ],
      },
      action: "Replace the age self-declaration with a token-based check before the renewal filing.",
    },
    {
      id: "breach-clocks",
      level: "amber",
      title: "Breach notification — two regimes, two clocks",
      source: "CERT-In · home page updates",
      matterPosition: {
        body: "A single incident runbook was drafted against the CERT-In six-hour reporting window, on the footing that it was the shorter of the two obligations.",
        cite: "Incident Response Review, 14 June 2024, section 3",
      },
      currentPosition: {
        body: "The DPDP intimation to affected data principals runs on its own trigger and is not satisfied by the CERT-In report. The revised CERT-In FAQ also narrows what starts the six-hour clock.",
        cite: "CERT-In FAQ revision, 2 September 2026",
      },
      action: "Split the runbook into two tracks with separate triggers and named owners.",
    },
    {
      id: "consent-manager",
      level: "amber",
      title: "Consent manager registration",
      source: "MeitY · Orders and notices",
      matterPosition: {
        body: "The advice treated consent manager registration as optional for the client's model.",
        cite: "Data Protection Advisory Note, 14 June 2024, paragraph 5.4",
      },
      currentPosition: {
        body: "The registration conditions and the net-worth threshold are now specified. The proposed group-level consent hub would fall inside the definition if it is offered to the affiliate entities.",
        cite: "DPDP Rules, 2025, Rule 4 and the First Schedule",
      },
      action: "Confirm whether the consent hub is offered outside the licensed entity.",
    },
    {
      id: "payment-localisation",
      level: "amber",
      title: "Payment data localisation — overlapping obligation",
      source: "RBI · Master directions",
      matterPosition: {
        body: "The memorandum proceeded on the 2018 storage direction as a standalone obligation.",
        cite: "Cross-border Memorandum, 14 June 2024, paragraphs 2.1–2.9",
      },
      currentPosition: {
        body: "The consolidated Master Direction restates the storage requirement and adds an express position on data processed abroad for analytics, with a reconciliation requirement on return.",
        cite: "RBI Master Direction on payment system data, updated 9 September 2026",
      },
      action: "Re-test the analytics pipeline against the reconciliation requirement.",
    },
    {
      id: "grievance",
      level: "green",
      title: "Grievance redressal timelines",
      source: "MeitY · Guidelines",
      matterPosition: {
        body: "Timelines were advised at the outer limits then applicable, with an internal target well inside them.",
        cite: "Compliance Gap Assessment, 14 June 2024, table 4",
      },
      currentPosition: {
        body: "Unchanged. The notified rules carry the same outer limits the advice assumed.",
        cite: "DPDP Rules, 2025, Rule 14",
      },
    },
    {
      id: "aadhaar-auth",
      level: "green",
      title: "Aadhaar-based authentication",
      source: "UIDAI · Regulations",
      matterPosition: {
        body: "The advice set out the AUA onboarding conditions and the permitted purposes for authentication.",
        cite: "Advisory note 14.06.2024, annexure B",
      },
      currentPosition: {
        body: "Unchanged. UIDAI's August 2026 circular revises the onboarding checklist only and does not touch the regulations relied on.",
        cite: "UIDAI circular, 28 August 2026",
      },
    },
  ],
};

export const TEST_SUMMARY = {
  positions: MATTER_TEST.positions.length,
  red: MATTER_TEST.positions.filter((p) => p.level === "red").length,
  amber: MATTER_TEST.positions.filter((p) => p.level === "amber").length,
  unchanged: MATTER_TEST.positions.filter((p) => p.level === "green").length,
};

/* ------------------------------------------------------------------ */
/* AI drafts                                                           */
/* ------------------------------------------------------------------ */

export interface Draft {
  id: string;
  client: string;
  matter: string;
  ref: string;
  partner: string;
  to: { name: string; email: string }[];
  cc: { name: string; email: string }[];
  subject: string;
  generated: string;
  provenance: string;
  opening: string[];
  points: { title: string; level: Level; body: string; cite: string }[];
  closing: string[];
  sources: { label: string; detail: string }[];
}

export const DRAFTS: Record<string, Draft> = {
  "helios-dp-0417": {
    id: "helios-dp-0417",
    client: "Helios Payments Pvt Ltd",
    matter: "Data protection compliance review",
    ref: "2024/DP/0417",
    partner: "R. Iyer",
    to: [{ name: "Rohan Desai", email: "rohan.desai@heliospay.in" }],
    cc: [
      { name: "Ananya Rao", email: "ananya.rao@heliospay.in" },
      { name: "R. Iyer", email: "r.iyer@trilegal.com" },
    ],
    subject: "DPDP Rules, 2025 — positions in our June 2024 advice that need revisiting",
    generated: "Drafted today, 06:12 IST",
    provenance:
      "Prepared by ANS from the matter file and the notified rules. Held for review; nothing has been sent.",
    opening: [
      "Dear Rohan,",
      "The Data Protection Rules were notified on 13 November 2025 and the notice provisions are now in force. We have run our June 2024 advice against the notified text. Five of the positions we took are affected, two of them materially. This note sets out what changes and what we suggest doing about it.",
    ],
    points: [
      {
        title: "Consent notice architecture",
        level: "red",
        body: "We advised a single layered notice with the itemised purposes to be settled once the rules were final. Rule 3 now prescribes the content of the notice itself, including an itemised description of the personal data and the specified purpose against each item. The Karnataka High Court has read that as requiring the itemisation to be legible in the notice, and declined to treat a hyperlinked schedule as compliance. The customer-facing notice and the in-product consent flow both need re-papering.",
        cite: "DPDP Rules, 2025, Rule 3; Vaidyanathan v. Union of India, W.P. 14882 of 2026 (under appeal)",
      },
      {
        title: "Consent already collected",
        level: "red",
        body: "The Data Protection Board has held that consent obtained on a pre-Rules notice does not carry forward, and directed fresh consent within ninety days. On our reading, the consents collected between March 2024 and the notification date sit within that holding.",
        cite: "In re: Aarohi Health Technologies, order dated 4 July 2026",
      },
      {
        title: "Breach reporting",
        level: "amber",
        body: "The single runbook we reviewed in June 2024 was built against the CERT-In six-hour window. The intimation to affected data principals runs on a separate trigger and is not satisfied by the CERT-In report. We suggest splitting the runbook into two tracks with named owners.",
        cite: "CERT-In FAQ revision, 2 September 2026; DPDP Rules, 2025, Rule 8",
      },
      {
        title: "Consent manager registration",
        level: "amber",
        body: "We treated registration as optional for your model. The registration conditions and the net-worth threshold are now specified, and the group-level consent hub would fall inside the definition if it is offered to the affiliate entities. We need to confirm how that is being deployed.",
        cite: "DPDP Rules, 2025, Rule 4 and the First Schedule",
      },
    ],
    closing: [
      "The two items in red are the ones with a date attached. If it would help, we can put a short call in this week and work back from the ninety-day window in the Aarohi order.",
      "Kind regards,",
      "Associate, for Trilegal",
    ],
    sources: [
      { label: "Matter file", detail: "2024/DP/0417 · 14 documents, last filed 2 March 2025" },
      {
        label: "Regulatory index",
        detail: "MeitY, CERT-In, RBI, UIDAI · 21 sources, refreshed today 06:00 IST",
      },
      { label: "Judicial index", detail: "3 judgments and orders tagged to the rules relied on" },
    ],
  },
  "northwind-tmt-1188": {
    id: "northwind-tmt-1188",
    client: "Northwind Broadcasting Ltd",
    matter: "Uplinking licence renewal",
    ref: "2024/TMT/1188",
    partner: "A. Menon",
    to: [{ name: "Meera Krishnan", email: "meera.k@northwind.tv" }],
    cc: [{ name: "A. Menon", email: "a.menon@trilegal.com" }],
    subject: "Revised uplinking guidelines — effect on the renewal strategy",
    generated: "Drafted 9 Sep 2026, 06:08 IST",
    provenance:
      "Prepared by ANS from the matter file and the revised guidelines. Held for review; nothing has been sent.",
    opening: [
      "Dear Meera,",
      "The Ministry has revised the uplinking and downlinking guidelines and issued two clarificatory notices since our March 2025 note. The renewal strategy in that note assumes the earlier position on transfer of control, and that assumption no longer holds.",
    ],
    points: [
      {
        title: "Transfer of control during the renewal window",
        level: "red",
        body: "The revised guidelines require prior approval where a change in shareholding crosses the specified threshold while a renewal application is pending. The step plan in the March 2025 note sequences the internal reorganisation inside that window.",
        cite: "Uplinking and downlinking guidelines, revised 21 August 2026, clause 9.4",
      },
      {
        title: "Subscriber consent notice",
        level: "amber",
        body: "Separately, the DPDP notice position has moved. The subscriber-facing notice on the OTT platform carries the same layered structure we advised on elsewhere, and the same redraft applies.",
        cite: "DPDP Rules, 2025, Rule 3",
      },
    ],
    closing: [
      "We suggest re-sequencing the reorganisation to sit either side of the renewal window. We can mark up the step plan this week.",
      "Kind regards,",
      "Associate, for Trilegal",
    ],
    sources: [
      { label: "Matter file", detail: "2024/TMT/1188 · 11 documents, last filed 2 March 2025" },
      { label: "Regulatory index", detail: "MIB, TRAI, DoT, MeitY · refreshed today 06:00 IST" },
      { label: "Judicial index", detail: "2 judgments and orders tagged to the rules relied on" },
    ],
  },
  "kavach-fin-0112": {
    id: "kavach-fin-0112",
    client: "Kavach Fintech",
    matter: "UPI arrangements",
    ref: "2026/FIN/0112",
    partner: "R. Iyer",
    to: [{ name: "Nikhil Barve", email: "nikhil@kavach.fin" }],
    cc: [{ name: "R. Iyer", email: "r.iyer@trilegal.com" }],
    subject: "NPCI market share circular — effect on the TPAP arrangement",
    generated: "Drafted 7 Sep 2026, 06:05 IST",
    provenance:
      "Prepared by ANS from the matter file and the circular. Held for review; nothing has been sent.",
    opening: [
      "Dear Nikhil,",
      "The NPCI circular on third-party application provider market share, read with the Reserve Bank's press release of 2 September 2026, changes the assumptions behind the volume projections in the arrangement we papered in February.",
    ],
    points: [
      {
        title: "Volume cap compliance",
        level: "amber",
        body: "The compliance method now runs on a rolling three-month basis rather than the annual measure the agreement contemplates. The reporting schedule in clause 7 should follow the same period.",
        cite: "NPCI circular, 28 August 2026",
      },
      {
        title: "Onboarding disclosures",
        level: "amber",
        body: "The press release signals that the disclosure at onboarding should name the underlying bank. The current flow names it only in the terms.",
        cite: "RBI press release, 2 September 2026",
      },
    ],
    closing: [
      "None of this is urgent, but the reporting schedule is easier to change now than at the first breach.",
      "Kind regards,",
      "Associate, for Trilegal",
    ],
    sources: [
      { label: "Matter file", detail: "2026/FIN/0112 · 6 documents, last filed 12 February 2026" },
      { label: "Regulatory index", detail: "RBI, NPCI · refreshed today 06:00 IST" },
    ],
  },
  "suryan-spc-0032": {
    id: "suryan-spc-0032",
    client: "Suryan Space Systems",
    matter: "Authorisation and spectrum",
    ref: "2025/SPC/0032",
    partner: "K. Rao",
    to: [{ name: "Anjali Bose", email: "anjali@suryanspace.in" }],
    cc: [{ name: "K. Rao", email: "k.rao@trilegal.com" }],
    subject: "IN-SPACe revised authorisation norms — non-geostationary constellations",
    generated: "Drafted 3 Sep 2026, 06:11 IST",
    provenance:
      "Prepared by ANS from the matter file and the revised norms. Held for review; nothing has been sent.",
    opening: [
      "Dear Anjali,",
      "IN-SPACe has published revised authorisation norms for non-geostationary constellations. Two of the positions in our 2025 note are affected.",
    ],
    points: [
      {
        title: "Debris mitigation undertakings",
        level: "amber",
        body: "The undertaking is now given at constellation level rather than per satellite, with a consolidated end-of-life plan. The filing pack should be restructured before the next tranche.",
        cite: "IN-SPACe authorisation norms, revised 1 September 2026",
      },
      {
        title: "Spectrum coordination",
        level: "amber",
        body: "The coordination step with the Department has been brought forward and now sits before the authorisation application rather than after it.",
        cite: "IN-SPACe authorisation norms, revised 1 September 2026, clause 12",
      },
    ],
    closing: [
      "We can restructure the filing pack alongside the next tranche if that is convenient.",
      "Kind regards,",
      "Associate, for Trilegal",
    ],
    sources: [
      { label: "Matter file", detail: "2025/SPC/0032 · 9 documents, last filed 18 June 2026" },
      { label: "Regulatory index", detail: "IN-SPACe, ISRO, DoT · refreshed today 06:00 IST" },
    ],
  },
};

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

export interface HistoryItem {
  id: string;
  level: Level;
  title: string;
  kind: string;
  when: string;
  body: string;
  outcome: string;
  href?: string;
}

export const HISTORY: HistoryItem[] = [
  {
    id: "h1",
    level: "red",
    title: "Helios Payments Pvt Ltd — Data protection compliance review",
    kind: "Matter scan · draft prepared",
    when: "Today, 06:12",
    body: "DPDP Rules, 2025 tested against the June 2024 advice. Five positions affected.",
    outcome: "Held for review",
    href: "/horizon/drafts/helios-dp-0417",
  },
  {
    id: "h2",
    level: "info",
    title: "Daily digest sent to 14 recipients",
    kind: "Alert delivery",
    when: "Today, 07:00",
    body: "21 sources checked, 4 had published since the last send.",
    outcome: "Delivered",
  },
  {
    id: "h3",
    level: "red",
    title: "Northwind Broadcasting Ltd — Uplinking licence renewal",
    kind: "Matter scan · draft prepared",
    when: "9 Sep 2026, 06:08",
    body: "Revised MIB guidelines and two clarificatory notices tested against the March 2025 note.",
    outcome: "Held for review",
    href: "/horizon/drafts/northwind-tmt-1188",
  },
  {
    id: "h4",
    level: "amber",
    title: "Kavach Fintech — UPI arrangements",
    kind: "Matter scan · draft prepared",
    when: "7 Sep 2026, 06:05",
    body: "NPCI market share circular read with the RBI press release of 2 September 2026.",
    outcome: "Held for review",
    href: "/horizon/drafts/kavach-fin-0112",
  },
  {
    id: "h5",
    level: "green",
    title: "Northwind Broadcasting Ltd — fortnightly newsletter",
    kind: "Newsletter",
    when: "8 Sep 2026, 09:00",
    body: "3 topics, 6 subscribers. Signed off by A. Menon.",
    outcome: "Sent",
  },
  {
    id: "h6",
    level: "amber",
    title: "Suryan Space Systems — Authorisation and spectrum",
    kind: "Matter scan · draft prepared",
    when: "3 Sep 2026, 06:11",
    body: "IN-SPACe revised authorisation norms for non-geostationary constellations.",
    outcome: "Held for review",
    href: "/horizon/drafts/suryan-spc-0032",
  },
];
