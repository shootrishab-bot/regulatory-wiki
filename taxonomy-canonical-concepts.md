# Cross-Regulator Taxonomy Audit and Canonical Concept Mapping

Generated from the live Neon Postgres database on 2026-09-07.

Every number and every definition quoted below was read directly out of `TaxonomyTag`,
`UpdateEntry` and `CanonicalConcept`. Nothing here comes from the taxonomy workbooks in
the repo — see Finding A, which is the reason that distinction matters.

---

## Headline findings

**A. Every live `UpdateEntry` row is tagged `taxonomyVersion = "v1.0"` — all 4,807 of them, at every regulator.**
There is no other value in the column (`v1.0`). This contradicts what the
taxonomy workbooks in the repo imply. Individual *tags* do carry later `versionAdded` values —
CCI's `Not Applicable` Status tag is marked `v1.3`, and all 24 of DST's tags are marked `v2.0` —
but no entry has ever been re-tagged against those versions. FIU's own seeded definition for
`Not Applicable` even cites "CCI's v1.3 correction" as its source. So the workbook version and
the live entry version are two different things, and only the tag-level `versionAdded` field
reflects taxonomy revisions at all.

**Practical consequence:** a reader cannot use `UpdateEntry.taxonomyVersion` to tell which
taxonomy revision an entry was classified against. It is currently a constant.

**B. ESIC has a complete seeded taxonomy (23 tags) and zero documents.**
It has no `SourceDocument` and no `UpdateEntry` rows at all, so it has no live taxonomy version.
Its tags are included in the mapping below because the vocabulary is real and seeded, but every
ESIC usage count in this report is a genuine zero, not a small number.

**C. 102 of 310 tags (33%) have never been applied to a single entry.**
Excluding ESIC's 23, that is still 79 unused tags at regulators that do have documents —
for example FIU, which has 31 tags and only 12 entries. A zero-usage tag says something different
from a heavily-used one, so the inventory below reports usage for every tag rather than only
listing vocabulary.

**D. The Status facet has converged almost completely; Subject has barely converged at all.**
All 11 regulators share `In Force`, `Amended` and `Draft / Under Consultation` by exact name,
with near-verbatim identical definitions. 52 of 55 Status tags map to a shared concept
(95%), against 21% of Subject tags. Section 5 addresses whether Status should therefore
be a shared enum rather than a mapping table.

**E. No CERC, APTEL, IRDAI or SEBI regulator exists in this database.**
The 11 regulators present are: CCI, CLC, DOS-ISRO, DOT, DST, EPFO, ESIC, FIU, MIB, MTCTE, SARALSANCHAR. The enforcement-order
pattern could only be checked across the regulators that actually exist; it was confirmed
between CCI and FIU and found absent everywhere else.

---

## 1. The real inventory

### 1.1 Live taxonomy version per regulator

Read from `UpdateEntry.taxonomyVersion` on real rows, joined through `SourceDocument` to
`Regulator` — the same way DOS-ISRO's live version was confirmed, applied to all 11.

| Regulator | Domain | Live taxonomy version | Entries | `versionAdded` values on its tags |
|---|---|---|---:|---|
| **CCI** | Competition Law | `v1.0` | 1,320 | `v1.0`, `v1.3` |
| **CLC** | Employment Law | `v1.0` | 50 | `v1.0` |
| **DOS-ISRO** | Space | `v1.0` | 562 | `v1.0` |
| **DOT** | Telecom | `v1.0` | 592 | `v1.0` |
| **DST** | Science and Technology | `v1.0` | 692 | `v2.0` |
| **EPFO** | Employment Law | `v1.0` | 5 | `v1.0` |
| **ESIC** | Employment Law | _no entries_ | 0 | `v1.0` |
| **FIU** | Anti-Money Laundering | `v1.0` | 12 | `v1.0`, `v1.1 (proposed)` |
| **MIB** | Information and Broadcasting | `v1.0` | 1,043 | `v1.0` |
| **MTCTE** | Telecom | `v1.0` | 151 | `v1.0` |
| **SARALSANCHAR** | Telecom | `v1.0` | 380 | `v1.0` |

The mismatch in the last two columns is Finding A. DST is the clearest case: every one of its
tags is marked `v2.0`, and every one of its 692 entries is tagged `v1.0`.

### 1.2 Tag counts by facet

| Regulator | Subject | Instrument Type | Status | Total | Unused (0 entries) |
|---|---:|---:|---:|---:|---:|
| **CCI** | 13 | 12 | 7 | 32 | 10 |
| **CLC** | 6 | 10 | 4 | 20 | 4 |
| **DOS-ISRO** | 12 | 11 | 6 | 29 | 2 |
| **DOT** | 13 | 11 | 4 | 28 | 8 |
| **DST** | 9 | 8 | 7 | 24 | 2 |
| **EPFO** | 9 | 9 | 4 | 22 | 18 |
| **ESIC** | 9 | 10 | 4 | 23 | 23 |
| **FIU** | 12 | 12 | 7 | 31 | 27 |
| **MIB** | 28 | 24 | 4 | 56 | 2 |
| **MTCTE** | 9 | 10 | 4 | 23 | 3 |
| **SARALSANCHAR** | 11 | 7 | 4 | 22 | 3 |
| **All** | **131** | **124** | **55** | **310** | **102** |

Note: `Facet` in the schema also defines `APPLICABILITY` and `LICENSE_AUTHORISATION_TYPE`,
but **no tag of either facet is seeded** — both are empty in the live database, including for
DoT, which the schema comment describes as the LICENSE_AUTHORISATION_TYPE case. Out of scope
for this task, but worth knowing before anyone relies on those facets.

### 1.3 Full tag inventory

Every tag, with the live taxonomy version of its regulator, its real usage count, and the
canonical concept it maps to (blank where it maps to nothing, which is the common case).

#### Subject

| Regulator | Tag | Short code | Live version | Usage | Tag status | Mapped concept |
|---|---|---|---|---:|---|---|
| CCI | Abuse of Dominant Position | `ABUSE` | v1.0 | 953 | ACTIVE |  |
| CCI | Anti-competitive Agreements & Cartel Enforcement | `ANTICOMP` | v1.0 | 271 | ACTIVE |  |
| CCI | Combination Compliance & Enforcement | `COMBENF` | v1.0 | 0 | ACTIVE |  |
| CCI | Combination Filing & Procedure | `COMBFILE` | v1.0 | 18 | ACTIVE |  |
| CCI | Combination Review & Approval | `COMBREV` | v1.0 | 13 | ACTIVE |  |
| CCI | Competition Advocacy & Outreach | `ADVOCACY` | v1.0 | 2 | ACTIVE |  |
| CCI | Competition Law Framework | `LAWFW` | v1.0 | 6 | ACTIVE |  |
| CCI | Institutional Governance & Administration | `GOV` | v1.0 | 3 | ACTIVE | Institutional Governance & Administration |
| CCI | International Cooperation | `INTL` | v1.0 | 0 | ACTIVE | International Cooperation |
| CCI | Market Studies & Economic Research | `MKTSTUDY` | v1.0 | 28 | ACTIVE |  |
| CCI | Public Information & Transparency | `RTI` | v1.0 | 0 | ACTIVE | Public Information & Transparency (RTI) |
| CCI | Recruitment, Procurement & Institutional Opportunities | `PROC` | v1.0 | 22 | ACTIVE |  |
| CCI | Rulemaking & Public Consultation | `RULEMK` | v1.0 | 4 | ACTIVE |  |
| CLC | Compliance Guidance (FAQs & Case Compendia) | `COMP` | v1.0 | 5 | ACTIVE |  |
| CLC | Governance and Administration | `GOV` | v1.0 | 1 | ACTIVE | Institutional Governance & Administration |
| CLC | Governance and Administration > Personnel/Establishment | `GOV-PE` | v1.0 | 5 | ACTIVE | Personnel / Establishment Matters |
| CLC | Industrial Relations & Trade Union Matters | `IR` | v1.0 | 4 | ACTIVE |  |
| CLC | Labour Codes & Acts Reference Library | `ACTS` | v1.0 | 15 | ACTIVE |  |
| CLC | Minimum Wages & Variable Dearness Allowance (VDA) | `MWVDA` | v1.0 | 20 | ACTIVE |  |
| DOS-ISRO | Commercial Launch Services & Contracts | `LAUNCH` | v1.0 | 22 | ACTIVE |  |
| DOS-ISRO | Institutional Governance & Administration | `GOV` | v1.0 | 36 | ACTIVE | Institutional Governance & Administration |
| DOS-ISRO | International Cooperation | `INTL` | v1.0 | 14 | ACTIVE | International Cooperation |
| DOS-ISRO | Procurement & Tenders | `PROC` | v1.0 | 130 | ACTIVE | Procurement & Tenders |
| DOS-ISRO | Public Information & Transparency | `RTI` | v1.0 | 5 | ACTIVE | Public Information & Transparency (RTI) |
| DOS-ISRO | Remote Sensing Data Policy & Licensing | `RSDP` | v1.0 | 94 | ACTIVE |  |
| DOS-ISRO | Satellite Communication (Spacecom) Policy & Authorization | `SPACOM` | v1.0 | 52 | ACTIVE |  |
| DOS-ISRO | Space Activity Authorization & Licensing | `AUTH` | v1.0 | 87 | ACTIVE |  |
| DOS-ISRO | Space Outreach & Education | `OUTREACH` | v1.0 | 100 | ACTIVE |  |
| DOS-ISRO | Space Sector Foreign Direct Investment (FDI) | `FDI` | v1.0 | 1 | ACTIVE |  |
| DOS-ISRO | Space Sector Policy Framework | `POLFW` | v1.0 | 13 | ACTIVE |  |
| DOS-ISRO | Technology Transfer & Industry Consortium | `TECHXFER` | v1.0 | 8 | ACTIVE |  |
| DOT | Foreign Direct Investment _(UNDER_REVIEW)_ | `FDI` | v1.0 | 0 | UNDER_REVIEW |  |
| DOT | Governance and Rulemaking | `GOV` | v1.0 | 76 | ACTIVE | Institutional Governance & Administration |
| DOT | Governance and Rulemaking > Personnel/Administration | `GOV-PA` | v1.0 | 99 | ACTIVE | Personnel / Establishment Matters |
| DOT | Government Connectivity Projects _(UNDER_REVIEW)_ | `GCP` | v1.0 | 0 | UNDER_REVIEW |  |
| DOT | International Cooperation _(UNDER_REVIEW)_ | `INTL` | v1.0 | 0 | UNDER_REVIEW | International Cooperation |
| DOT | Licensing | `LIC` | v1.0 | 45 | ACTIVE |  |
| DOT | Licensing > Unified License / Access Services | `LIC-UL` | v1.0 | 268 | ACTIVE |  |
| DOT | Licensing > VSAT / Satellite Communication | `LIC-VSAT` | v1.0 | 20 | ACTIVE |  |
| DOT | Network Security / Content Compliance | `NSCC` | v1.0 | 65 | ACTIVE |  |
| DOT | PSU Matters _(UNDER_REVIEW)_ | `PSU` | v1.0 | 0 | UNDER_REVIEW |  |
| DOT | Spectrum Management | `SPEC` | v1.0 | 19 | ACTIVE |  |
| DOT | Standardization and R&D _(UNDER_REVIEW)_ | `RD` | v1.0 | 0 | UNDER_REVIEW |  |
| DOT | Universal Service Obligation Fund _(UNDER_REVIEW)_ | `USOF` | v1.0 | 0 | UNDER_REVIEW |  |
| DST | Ethics & Conflict of Interest Guidelines | `ETH` | v1.0 | 1 | ACTIVE |  |
| DST | Financial Rules & Fund Administration | `FIN` | v1.0 | 8 | ACTIVE |  |
| DST | Funding Calls & Proposals (Bilateral/International) | `FCI` | v1.0 | 273 | ACTIVE |  |
| DST | Funding Calls & Proposals (Domestic) | `FCD` | v1.0 | 264 | ACTIVE |  |
| DST | Governance and Administration | `GOV` | v1.0 | 7 | ACTIVE | Institutional Governance & Administration |
| DST | National S&T Policies | `POL` | v1.0 | 16 | ACTIVE |  |
| DST | Proposal Results & Selection Lists | `RES` | v1.0 | 111 | ACTIVE |  |
| DST | Service Conditions & Recruitment Rules | `SVC` | v1.0 | 9 | ACTIVE |  |
| DST | Statutory Notifications & Gazette Instruments | `GAZ` | v1.0 | 3 | ACTIVE |  |
| EPFO | Enforcement, Exemption & Recovery | `ENF` | v1.0 | 0 | ACTIVE |  |
| EPFO | Governance and Administration | `GOV` | v1.0 | 0 | ACTIVE | Institutional Governance & Administration |
| EPFO | Governance and Administration > Empanelment & Procurement | `GOV-EMP` | v1.0 | 2 | ACTIVE | Procurement & Tenders |
| EPFO | Governance and Administration > Official Language (Rajbhasha) | `GOV-OL` | v1.0 | 0 | ACTIVE | Official Language (Rajbhasha) |
| EPFO | Governance and Administration > Personnel/Establishment | `GOV-PE` | v1.0 | 0 | ACTIVE | Personnel / Establishment Matters |
| EPFO | Internal Audit & Financial Administration | `AUD` | v1.0 | 0 | ACTIVE |  |
| EPFO | International Social Security Agreements | `ISSA` | v1.0 | 0 | ACTIVE |  |
| EPFO | Member Services & Grievance Redressal | `MSGR` | v1.0 | 3 | ACTIVE |  |
| EPFO | Provident Fund Interest & Member Accounts | `PFI` | v1.0 | 0 | ACTIVE |  |
| ESIC | Governance and Administration | `GOV` | — | 0 | ACTIVE | Institutional Governance & Administration |
| ESIC | Governance and Administration > IT Systems & Digital Infrastructure | `GOV-IT` | — | 0 | ACTIVE |  |
| ESIC | Governance and Administration > Official Language (Rajbhasha) | `GOV-OL` | — | 0 | ACTIVE | Official Language (Rajbhasha) |
| ESIC | Governance and Administration > Personnel/Establishment | `GOV-PE` | — | 0 | ACTIVE | Personnel / Establishment Matters |
| ESIC | Hospital & Medical Services Administration | `HMSA` | — | 0 | ACTIVE |  |
| ESIC | Insured Persons, Registration & Revenue Administration | `IPRA` | — | 0 | ACTIVE |  |
| ESIC | Litigation Management & Legal Empanelment | `LIT` | — | 0 | ACTIVE |  |
| ESIC | Procurement & Rate Contracts | `PRC` | — | 0 | ACTIVE | Procurement & Tenders |
| ESIC | Regulations & Rulemaking | `REG` | — | 0 | ACTIVE |  |
| FIU | AML/CFT Guidelines for Reporting Entities | `GUIDE` | v1.0 | 0 | ACTIVE |  |
| FIU | Enforcement Actions & Penalties | `ENF` | v1.0 | 11 | ACTIVE |  |
| FIU | Institutional Governance & Administration | `GOV` | v1.0 | 0 | ACTIVE | Institutional Governance & Administration |
| FIU | Institutional Reporting & Annual Disclosures | `AR` | v1.0 | 0 | ACTIVE |  |
| FIU | International Cooperation & FATF Compliance | `INTL` | v1.0 | 0 | ACTIVE | International Cooperation |
| FIU | PMLA Legislative Framework | `PMLA` | v1.0 | 0 | ACTIVE |  |
| FIU | Procurement & Tenders | `PROC` | v1.0 | 0 | ACTIVE | Procurement & Tenders |
| FIU | Public Communication & Outreach | `OUTREACH` | v1.0 | 0 | ACTIVE |  |
| FIU | Public Information & Transparency | `RTI` | v1.0 | 0 | ACTIVE | Public Information & Transparency (RTI) |
| FIU | Recruitment & Institutional Opportunities | `RECRUIT` | v1.0 | 0 | ACTIVE |  |
| FIU | Reporting Entity Registration & Designation | `REREG` | v1.0 | 0 | ACTIVE |  |
| FIU | Virtual Digital Asset (VDA) Regulation | `VDA` | v1.0 | 1 | ACTIVE |  |
| MIB | AVGC Sector Promotion | `AVGC` | v1.0 | 56 | ACTIVE |  |
| MIB | Broadcast Content & Programme Code Compliance | `PCODE` | v1.0 | 88 | ACTIVE |  |
| MIB | Cable TV / MSO / LCO Regulation | `CABLE` | v1.0 | 53 | ACTIVE |  |
| MIB | Content Accessibility (Disability Compliance) | `ACCESS` | v1.0 | 42 | ACTIVE |  |
| MIB | DTH/HITS/IPTV Licensing | `DTH` | v1.0 | 16 | ACTIVE |  |
| MIB | Digital Media & OTT Regulation (IT Rules 2021) | `OTT` | v1.0 | 48 | ACTIVE |  |
| MIB | Doordarshan/Akashvani Mandatory Carriage | `DDCARR` | v1.0 | 11 | ACTIVE |  |
| MIB | Draft Broadcasting Services (Regulation) Bill, 2023 | `BSRB` | v1.0 | 3 | ACTIVE |  |
| MIB | Draft Telecom TV/Radio Rules 2026 | `TELRUL` | v1.0 | 4 | ACTIVE |  |
| MIB | FM/CRS Radio Broadcasting Licensing | `FMRAD` | v1.0 | 70 | ACTIVE |  |
| MIB | Film Certification & Exhibition | `FILMC` | v1.0 | 31 | ACTIVE |  |
| MIB | Film Promotion & Financial Incentive Schemes | `FILMP` | v1.0 | 85 | ACTIVE |  |
| MIB | Government Publicity Campaign Advisories | `PUBCAM` | v1.0 | 13 | ACTIVE |  |
| MIB | Grievance Redressal _(UNDER_REVIEW)_ | `GRIEV` | v1.0 | 0 | UNDER_REVIEW |  |
| MIB | International Co-production Agreements | `COPROD` | v1.0 | 23 | ACTIVE |  |
| MIB | Judicial Compliance / Court Orders | `COURT` | v1.0 | 11 | ACTIVE |  |
| MIB | Ministry & Autonomous Body Financial/Administrative Reporting | `FINRPT` | v1.0 | 64 | ACTIVE |  |
| MIB | Ministry Internal Administration (HR/Recruitment/Establishment) | `ADMIN` | v1.0 | 69 | ACTIVE | Personnel / Establishment Matters |
| MIB | National Film Awards Administration | `NFA` | v1.0 | 10 | ACTIVE |  |
| MIB | Press & Periodicals Registration | `PRESS` | v1.0 | 6 | ACTIVE |  |
| MIB | Public Communications & Media/Cultural Event Coverage | `PRCOM` | v1.0 | 240 | ACTIVE |  |
| MIB | Public Service Broadcasting Obligation | `PSB` | v1.0 | 15 | ACTIVE |  |
| MIB | Sector Research & Statistical Publications | `RESRCH` | v1.0 | 45 | ACTIVE |  |
| MIB | Self-Regulatory Body Registration & Recognition | `SRB` | v1.0 | 2 | ACTIVE |  |
| MIB | Sports Broadcasting Signal Sharing (Prasar Bharati) | `SPORTS` | v1.0 | 4 | ACTIVE |  |
| MIB | TV Channel Monitoring & Enforcement | `MONITOR` | v1.0 | 9 | ACTIVE |  |
| MIB | Television Rating Agencies / TRP Policy | `TRP` | v1.0 | 11 | ACTIVE |  |
| MIB | Uplinking/Downlinking & Channel Permissions | `UPDOWN` | v1.0 | 13 | ACTIVE |  |
| MTCTE | Appeals | `APP` | v1.0 | 3 | ACTIVE |  |
| MTCTE | Certificate Terms & Conditions | `CERT` | v1.0 | 2 | ACTIVE |  |
| MTCTE | Conformity Assessment Bodies & Test Labs | `CAB` | v1.0 | 7 | ACTIVE |  |
| MTCTE | Essential Requirements & Product Categories | `ER` | v1.0 | 11 | ACTIVE |  |
| MTCTE | Exemptions | `EXEMPT` | v1.0 | 52 | ACTIVE |  |
| MTCTE | Governance and Rulemaking | `GOV` | v1.0 | 1 | ACTIVE |  |
| MTCTE | Security Certification | `SEC` | v1.0 | 6 | ACTIVE |  |
| MTCTE | Testing & Certification Procedure | `PROC` | v1.0 | 69 | ACTIVE |  |
| MTCTE | Voluntary Certification Scheme _(DEPRECATED)_ | `VOL` | v1.0 | 0 | DEPRECATED |  |
| SARALSANCHAR | Certification & Proficiency Licenses | `CERT` | v1.0 | 41 | ACTIVE |  |
| SARALSANCHAR | Digital Bharat Nidhi & Universal Service Obligations | `DBN` | v1.0 | 5 | ACTIVE |  |
| SARALSANCHAR | Fees, Revenue Management & SUC | `FEES` | v1.0 | 13 | ACTIVE |  |
| SARALSANCHAR | Governance and Administration | `GOV` | v1.0 | 77 | ACTIVE | Institutional Governance & Administration |
| SARALSANCHAR | Radio Equipment Possession Authorisation (REPA) | `REPA` | v1.0 | 5 | ACTIVE |  |
| SARALSANCHAR | Registrations & Aggregator Services (PM-WANI, M2M, PDOA, IP1) | `REGSVC` | v1.0 | 2 | ACTIVE |  |
| SARALSANCHAR | Right of Way (RoW) & Infrastructure Permissions | `ROW` | v1.0 | 116 | ACTIVE |  |
| SARALSANCHAR | SACFA Clearances | `SACFA` | v1.0 | 6 | ACTIVE |  |
| SARALSANCHAR | Telecom Cyber Security & Equipment Compliance | `TCS` | v1.0 | 85 | ACTIVE |  |
| SARALSANCHAR | Unified License, Authorisation & Migration | `UL` | v1.0 | 13 | ACTIVE |  |
| SARALSANCHAR | WPC Licensing (Network, Non-Network, Satellite, Import) | `WPC` | v1.0 | 16 | ACTIVE |  |

#### Instrument Type

| Regulator | Tag | Short code | Live version | Usage | Tag status | Mapped concept |
|---|---|---|---|---:|---|---|
| CCI | Act | `ACT` | v1.0 | 0 | ACTIVE | Primary Legislation (Act) |
| CCI | Annual Report | `AR` | v1.0 | 0 | ACTIVE | Annual Report |
| CCI | Award of Work / Institutional Notice | `AWARD` | v1.0 | 4 | ACTIVE |  |
| CCI | CCI Order | `ORDER` | v1.0 | 1221 | ACTIVE | Enforcement / Adjudicatory Order |
| CCI | FAQ | `FAQ` | v1.0 | 0 | ACTIVE | FAQ |
| CCI | Market Study / Research Report | `MSTUDY` | v1.0 | 27 | ACTIVE |  |
| CCI | Notification | `NOT` | v1.0 | 25 | ACTIVE |  |
| CCI | Press Release | `PR` | v1.0 | 14 | ACTIVE | Press Release |
| CCI | Public Notice / Consultation Notice | `PNOTICE` | v1.0 | 10 | ACTIVE | Public Consultation / Draft for Comments |
| CCI | Recruitment / Empanelment Notice | `RECRUIT` | v1.0 | 3 | ACTIVE | Recruitment / Vacancy Notice |
| CCI | Regulation | `REG` | v1.0 | 0 | ACTIVE | Regulations |
| CCI | Tender / RFP | `TND` | v1.0 | 16 | ACTIVE | Procurement Tender / RFP |
| CLC | Act | `ACT` | v1.0 | 14 | ACTIVE | Primary Legislation (Act) |
| CLC | Circular | `CIR` | v1.0 | 0 | ACTIVE | Administrative Circular |
| CLC | Compendium | `CMP` | v1.0 | 3 | ACTIVE |  |
| CLC | Corrigendum | `COR` | v1.0 | 3 | ACTIVE | Corrigendum |
| CLC | FAQ | `FAQ` | v1.0 | 4 | ACTIVE | FAQ |
| CLC | Instruction/Clarification | `INST` | v1.0 | 4 | ACTIVE |  |
| CLC | Notice | `NOT` | v1.0 | 0 | ACTIVE |  |
| CLC | Order | `ORD` | v1.0 | 18 | ACTIVE |  |
| CLC | Policy | `POL` | v1.0 | 2 | ACTIVE |  |
| CLC | Rules | `RUL` | v1.0 | 2 | ACTIVE |  |
| DOS-ISRO | Act / Bill | `ACT` | v1.0 | 0 | ACTIVE | Primary Legislation (Act) |
| DOS-ISRO | Annual Report | `AR` | v1.0 | 28 | ACTIVE | Annual Report |
| DOS-ISRO | Authorization | `AUTH` | v1.0 | 207 | ACTIVE |  |
| DOS-ISRO | Contract / Agreement | `CTR` | v1.0 | 9 | ACTIVE |  |
| DOS-ISRO | FAQ | `FAQ` | v1.0 | 1 | ACTIVE | FAQ |
| DOS-ISRO | Norms, Guidelines and Procedures (NGP) | `NGP` | v1.0 | 16 | ACTIVE |  |
| DOS-ISRO | Notification / Circular | `NOT` | v1.0 | 14 | ACTIVE |  |
| DOS-ISRO | Policy | `POL` | v1.0 | 3 | ACTIVE | Sector / National Policy Document |
| DOS-ISRO | Press Release | `PR` | v1.0 | 140 | ACTIVE | Press Release |
| DOS-ISRO | RTI Response / Disclosure | `RTID` | v1.0 | 0 | ACTIVE | RTI Response / Disclosure |
| DOS-ISRO | Tender / RFP | `TND` | v1.0 | 144 | ACTIVE | Procurement Tender / RFP |
| DOT | Act | `ACT` | v1.0 | 0 | ACTIVE | Primary Legislation (Act) |
| DOT | Corrigendum | `COR` | v1.0 | 7 | ACTIVE | Corrigendum |
| DOT | Gazette Notification | `GAZ` | v1.0 | 25 | ACTIVE | Gazette Notification |
| DOT | Guidelines | `GDL` | v1.0 | 5 | ACTIVE | Guidelines |
| DOT | Notice | `NOT` | v1.0 | 22 | ACTIVE |  |
| DOT | Office Memorandum | `OM` | v1.0 | 1 | ACTIVE | Office Memorandum |
| DOT | Order | `ORD` | v1.0 | 393 | ACTIVE |  |
| DOT | Press Release | `PR` | v1.0 | 62 | ACTIVE | Press Release |
| DOT | Publication | `PUB` | v1.0 | 28 | ACTIVE |  |
| DOT | Report | `REP` | v1.0 | 4 | ACTIVE |  |
| DOT | Rules | `RUL` | v1.0 | 40 | ACTIVE | Subordinate Legislation (Rules made under an Act) |
| DST | Call for Proposals | `CFP` | v1.0 | 531 | ACTIVE |  |
| DST | Draft Rules / Consultation Notice | `DFT` | v1.0 | 1 | ACTIVE | Public Consultation / Draft for Comments |
| DST | Gazette Notification | `GAZ` | v1.0 | 5 | ACTIVE | Gazette Notification |
| DST | Guidelines | `GDL` | v1.0 | 13 | ACTIVE | Guidelines |
| DST | Office Memorandum (OM) | `OM` | v1.0 | 18 | ACTIVE | Office Memorandum |
| DST | Policy Document | `POL` | v1.0 | 11 | ACTIVE | Sector / National Policy Document |
| DST | Results / Selection List | `RSL` | v1.0 | 111 | ACTIVE |  |
| DST | Special Financial Rules (SFR) | `SFR` | v1.0 | 2 | ACTIVE |  |
| EPFO | Advertisement | `ADV` | v1.0 | 0 | ACTIVE | Recruitment / Vacancy Notice |
| EPFO | Agreement | `AGR` | v1.0 | 0 | ACTIVE |  |
| EPFO | Circular | `CIR` | v1.0 | 0 | ACTIVE | Administrative Circular |
| EPFO | Corrigendum | `COR` | v1.0 | 0 | ACTIVE | Corrigendum |
| EPFO | Notice | `NOT` | v1.0 | 5 | ACTIVE |  |
| EPFO | Notification | `NTF` | v1.0 | 0 | ACTIVE |  |
| EPFO | Office Order | `OO` | v1.0 | 0 | ACTIVE | Office Order |
| EPFO | Rules | `RUL` | v1.0 | 0 | ACTIVE |  |
| EPFO | Scheme | `SCH` | v1.0 | 0 | ACTIVE | Named Government Scheme |
| ESIC | Circular | `CIR` | — | 0 | ACTIVE | Administrative Circular |
| ESIC | Corrigendum | `COR` | — | 0 | ACTIVE | Corrigendum |
| ESIC | Guidelines | `GDL` | — | 0 | ACTIVE | Guidelines |
| ESIC | Letter | `LTR` | — | 0 | ACTIVE |  |
| ESIC | Notice | `NOT` | — | 0 | ACTIVE |  |
| ESIC | Notification | `NTF` | — | 0 | ACTIVE |  |
| ESIC | Office Memorandum | `OM` | — | 0 | ACTIVE | Office Memorandum |
| ESIC | Office Order | `OO` | — | 0 | ACTIVE | Office Order |
| ESIC | Order | `ORD` | — | 0 | ACTIVE |  |
| ESIC | Regulations | `RGN` | — | 0 | ACTIVE | Regulations |
| FIU | Act | `ACT` | v1.0 | 0 | ACTIVE | Primary Legislation (Act) |
| FIU | Adjudication / Penalty Order | `ORDER` | v1.0 | 12 | ACTIVE | Enforcement / Adjudicatory Order |
| FIU | Annual Report | `AR` | v1.0 | 0 | ACTIVE | Annual Report |
| FIU | Circular | `CIRC` | v1.0 | 0 | ACTIVE | Administrative Circular |
| FIU | FAQ | `FAQ` | v1.0 | 0 | ACTIVE | FAQ |
| FIU | Guidelines | `GUIDE` | v1.0 | 0 | ACTIVE | Guidelines |
| FIU | Notification | `NOT` | v1.0 | 0 | ACTIVE |  |
| FIU | Press Release | `PR` | v1.0 | 0 | ACTIVE | Press Release |
| FIU | RTI Response / Disclosure | `RTID` | v1.0 | 0 | ACTIVE | RTI Response / Disclosure |
| FIU | Recruitment / Vacancy Notice | `VACANCY` | v1.0 | 0 | ACTIVE | Recruitment / Vacancy Notice |
| FIU | Rules | `RULES` | v1.0 | 0 | ACTIVE | Subordinate Legislation (Rules made under an Act) |
| FIU | Tender / RFP | `TND` | v1.0 | 0 | ACTIVE | Procurement Tender / RFP |
| MIB | Act / Amendment Act | `ACT` | v1.0 | 8 | ACTIVE | Primary Legislation (Act) |
| MIB | Advisory | `ADV` | v1.0 | 174 | ACTIVE |  |
| MIB | Annual Report / Annual Accounts | `ANR` | v1.0 | 30 | ACTIVE | Annual Report |
| MIB | Budget / Financial Document | `BUD` | v1.0 | 20 | ACTIVE |  |
| MIB | Circular | `CIR` | v1.0 | 2 | ACTIVE | Administrative Circular |
| MIB | Citizen Charter | `CC` | v1.0 | 4 | ACTIVE |  |
| MIB | Corrigendum | `COR` | v1.0 | 7 | ACTIVE | Corrigendum |
| MIB | E-Book / Handbook / Statistical Publication | `EBK` | v1.0 | 26 | ACTIVE |  |
| MIB | FM Radio Auction Notice | `AUC` | v1.0 | 4 | ACTIVE |  |
| MIB | Guidelines | `GDL` | v1.0 | 23 | ACTIVE | Guidelines |
| MIB | International Agreement | `IAG` | v1.0 | 19 | ACTIVE |  |
| MIB | Monthly Cabinet Summary | `MCS` | v1.0 | 6 | ACTIVE |  |
| MIB | Notification / Notice | `NOT` | v1.0 | 55 | ACTIVE |  |
| MIB | Office Memorandum | `OM` | v1.0 | 33 | ACTIVE | Office Memorandum |
| MIB | Order | `ORD` | v1.0 | 66 | ACTIVE |  |
| MIB | Other / Administrative | `OTH` | v1.0 | 32 | ACTIVE |  |
| MIB | Policy | `POL` | v1.0 | 7 | ACTIVE | Sector / National Policy Document |
| MIB | Press Release | `PR` | v1.0 | 462 | ACTIVE | Press Release |
| MIB | Public Consultation / Draft for Comments | `CONS` | v1.0 | 20 | ACTIVE | Public Consultation / Draft for Comments |
| MIB | Regulations | `REG` | v1.0 | 2 | ACTIVE | Regulations |
| MIB | Rules | `RUL` | v1.0 | 15 | ACTIVE | Subordinate Legislation (Rules made under an Act) |
| MIB | Scheme | `SCH` | v1.0 | 5 | ACTIVE | Named Government Scheme |
| MIB | Tender Notice _(UNDER_REVIEW)_ | `TND` | v1.0 | 0 | UNDER_REVIEW | Procurement Tender / RFP |
| MIB | Vacancy / Recruitment Notice | `VAC` | v1.0 | 20 | ACTIVE | Recruitment / Vacancy Notice |
| MTCTE | Circular/Letter | `CIR` | v1.0 | 7 | ACTIVE | Administrative Circular |
| MTCTE | Clarification | `CLR` | v1.0 | 12 | ACTIVE |  |
| MTCTE | Consultation | `CONS` | v1.0 | 0 | ACTIVE | Public Consultation / Draft for Comments |
| MTCTE | FAQ | `FAQ` | v1.0 | 1 | ACTIVE | FAQ |
| MTCTE | Notification | `NOT` | v1.0 | 94 | ACTIVE |  |
| MTCTE | Procedure Document | `PROC` | v1.0 | 15 | ACTIVE |  |
| MTCTE | Proforma/Form | `FORM` | v1.0 | 5 | ACTIVE |  |
| MTCTE | Reference Document | `REF` | v1.0 | 11 | ACTIVE |  |
| MTCTE | Rules | `RUL` | v1.0 | 2 | ACTIVE | Subordinate Legislation (Rules made under an Act) |
| MTCTE | User Instructions | `UI` | v1.0 | 4 | ACTIVE |  |
| SARALSANCHAR | Circulars | `CIR` | v1.0 | 21 | ACTIVE | Administrative Circular |
| SARALSANCHAR | DO Letters | `DO` | v1.0 | 83 | ACTIVE |  |
| SARALSANCHAR | Notifications | `NTF` | v1.0 | 123 | ACTIVE |  |
| SARALSANCHAR | Orders | `ORD` | v1.0 | 118 | ACTIVE |  |
| SARALSANCHAR | Policy, Act and Rules | `PAR` | v1.0 | 8 | ACTIVE |  |
| SARALSANCHAR | Presentations | `PRES` | v1.0 | 22 | ACTIVE |  |
| SARALSANCHAR | Press Release | `PR` | v1.0 | 4 | ACTIVE | Press Release |

#### Status

| Regulator | Tag | Short code | Live version | Usage | Tag status | Mapped concept |
|---|---|---|---|---:|---|---|
| CCI | Amended | `AMD` | v1.0 | 1 | ACTIVE | Amended |
| CCI | Draft / Under Consultation | `DFT` | v1.0 | 1 | ACTIVE | Draft / Under Consultation |
| CCI | In Force | `INF` | v1.0 | 1317 | ACTIVE | In Force |
| CCI | Not Applicable | `NA` | v1.0 | 1 | ACTIVE | Not Applicable |
| CCI | Repealed | `REP` | v1.0 | 0 | ACTIVE | Repealed |
| CCI | Superseded | `SUP` | v1.0 | 0 | ACTIVE | Superseded |
| CCI | Under Litigation / Stayed | `LIT` | v1.0 | 0 | ACTIVE | Under Litigation / Stayed |
| CLC | Amended | `AMD` | v1.0 | 0 | ACTIVE | Amended |
| CLC | Draft / Under Consultation | `DFT` | v1.0 | 0 | ACTIVE | Draft / Under Consultation |
| CLC | In Force | `INF` | v1.0 | 33 | ACTIVE | In Force |
| CLC | Superseded / Repealed | `SUP` | v1.0 | 17 | ACTIVE | Superseded / Repealed (combined) |
| DOS-ISRO | Amended | `AMD` | v1.0 | 9 | ACTIVE | Amended |
| DOS-ISRO | Draft / Under Consultation | `DFT` | v1.0 | 2 | ACTIVE | Draft / Under Consultation |
| DOS-ISRO | In Force | `INF` | v1.0 | 394 | ACTIVE | In Force |
| DOS-ISRO | Not Applicable | `NA` | v1.0 | 152 | ACTIVE | Not Applicable |
| DOS-ISRO | Repealed | `REP` | v1.0 | 2 | ACTIVE | Repealed |
| DOS-ISRO | Superseded | `SUP` | v1.0 | 2 | ACTIVE | Superseded |
| DOT | Amended | `AMD` | v1.0 | 1 | ACTIVE | Amended |
| DOT | Draft / Under Consultation | `DFT` | v1.0 | 25 | ACTIVE | Draft / Under Consultation |
| DOT | In Force | `INF` | v1.0 | 566 | ACTIVE | In Force |
| DOT | Superseded / Repealed | `SUP` | v1.0 | 0 | ACTIVE | Superseded / Repealed (combined) |
| DST | Amended | `AMD` | v1.0 | 0 | ACTIVE | Amended |
| DST | Closed / Applications Closed | `CLSD` | v1.0 | 407 | ACTIVE |  |
| DST | Draft / Under Consultation | `DFT` | v1.0 | 1 | ACTIVE | Draft / Under Consultation |
| DST | In Force | `INF` | v1.0 | 46 | ACTIVE | In Force |
| DST | Open / Accepting Applications | `OPEN` | v1.0 | 129 | ACTIVE |  |
| DST | Results Announced | `RSLT` | v1.0 | 109 | ACTIVE |  |
| DST | Superseded | `SUP` | v1.0 | 0 | ACTIVE | Superseded |
| EPFO | Amended | `AMD` | v1.0 | 0 | ACTIVE | Amended |
| EPFO | Draft / Under Consultation | `DFT` | v1.0 | 0 | ACTIVE | Draft / Under Consultation |
| EPFO | In Force | `INF` | v1.0 | 5 | ACTIVE | In Force |
| EPFO | Superseded / Repealed | `SUP` | v1.0 | 0 | ACTIVE | Superseded / Repealed (combined) |
| ESIC | Amended | `AMD` | — | 0 | ACTIVE | Amended |
| ESIC | Draft / Under Consultation | `DFT` | — | 0 | ACTIVE | Draft / Under Consultation |
| ESIC | In Force | `INF` | — | 0 | ACTIVE | In Force |
| ESIC | Superseded / Repealed | `SUP` | — | 0 | ACTIVE | Superseded / Repealed (combined) |
| FIU | Amended | `AMD` | v1.0 | 0 | ACTIVE | Amended |
| FIU | Draft / Under Consultation | `DFT` | v1.0 | 0 | ACTIVE | Draft / Under Consultation |
| FIU | In Force | `INF` | v1.0 | 12 | ACTIVE | In Force |
| FIU | Not Applicable | `NA` | v1.0 | 0 | ACTIVE | Not Applicable |
| FIU | Repealed | `REP` | v1.0 | 0 | ACTIVE | Repealed |
| FIU | Superseded | `SUP` | v1.0 | 0 | ACTIVE | Superseded |
| FIU | Under Litigation / Stayed | `LIT` | v1.0 | 0 | ACTIVE | Under Litigation / Stayed |
| MIB | Amended | `AMD` | v1.0 | 2 | ACTIVE | Amended |
| MIB | Draft / Under Consultation | `DFT` | v1.0 | 19 | ACTIVE | Draft / Under Consultation |
| MIB | In Force | `INF` | v1.0 | 1021 | ACTIVE | In Force |
| MIB | Superseded / Repealed | `SUP` | v1.0 | 1 | ACTIVE | Superseded / Repealed (combined) |
| MTCTE | Amended | `AMD` | v1.0 | 1 | ACTIVE | Amended |
| MTCTE | Draft / Under Consultation | `DFT` | v1.0 | 0 | ACTIVE | Draft / Under Consultation |
| MTCTE | In Force | `INF` | v1.0 | 139 | ACTIVE | In Force |
| MTCTE | Superseded / Repealed | `SUP` | v1.0 | 11 | ACTIVE | Superseded / Repealed (combined) |
| SARALSANCHAR | Amended | `AMD` | v1.0 | 0 | ACTIVE | Amended |
| SARALSANCHAR | Draft / Under Consultation | `DFT` | v1.0 | 0 | ACTIVE | Draft / Under Consultation |
| SARALSANCHAR | In Force | `INF` | v1.0 | 380 | ACTIVE | In Force |
| SARALSANCHAR | Superseded / Repealed | `SUP` | v1.0 | 0 | ACTIVE | Superseded / Repealed (combined) |

---

## 2. Comparison: exact matches, near-duplicates, false cognates

### 2.1 Exact string matches across 2+ regulators

Computed from the real tag names, not assumed. **A name match is listed here as an observation,
not as a conclusion** — the last column records whether reading the definitions confirmed it.

#### Subject — 8 names shared by 2+ regulators

| Tag name | Regulators | # | Verdict |
|---|---|---:|---|
| Governance and Administration | CLC, DST, EPFO, ESIC, SARALSANCHAR | 5 | mapped → **Institutional Governance & Administration** |
| Governance and Administration > Personnel/Establishment | CLC, EPFO, ESIC | 3 | mapped → **Personnel / Establishment Matters** |
| Institutional Governance & Administration | CCI, DOS-ISRO, FIU | 3 | mapped → **Institutional Governance & Administration** |
| International Cooperation | CCI, DOS-ISRO, DOT | 3 | mapped → **International Cooperation** |
| Public Information & Transparency | CCI, DOS-ISRO, FIU | 3 | mapped → **Public Information & Transparency (RTI)** |
| Governance and Administration > Official Language (Rajbhasha) | EPFO, ESIC | 2 | mapped → **Official Language (Rajbhasha)** |
| Governance and Rulemaking | DOT, MTCTE | 2 | mapped → **Institutional Governance & Administration** |
| Procurement & Tenders | DOS-ISRO, FIU | 2 | mapped → **Procurement & Tenders** |

#### Instrument Type — 19 names shared by 2+ regulators

| Tag name | Regulators | # | Verdict |
|---|---|---:|---|
| Press Release | CCI, DOS-ISRO, DOT, FIU, MIB, SARALSANCHAR | 6 | mapped → **Press Release** |
| Rules | CLC, DOT, EPFO, FIU, MIB, MTCTE | 6 | mapped → **Subordinate Legislation (Rules made under an Act)** |
| Circular | CLC, EPFO, ESIC, FIU, MIB | 5 | mapped → **Administrative Circular** |
| Corrigendum | CLC, DOT, EPFO, ESIC, MIB | 5 | mapped → **Corrigendum** |
| FAQ | CCI, CLC, DOS-ISRO, FIU, MTCTE | 5 | mapped → **FAQ** |
| Guidelines | DOT, DST, ESIC, FIU, MIB | 5 | mapped → **Guidelines** |
| Notification | CCI, EPFO, ESIC, FIU, MTCTE | 5 | **FALSE COGNATE — not mapped** |
| Act | CCI, CLC, DOT, FIU | 4 | mapped → **Primary Legislation (Act)** |
| Notice | CLC, DOT, EPFO, ESIC | 4 | not mapped |
| Order | CLC, DOT, ESIC, MIB | 4 | **FALSE COGNATE — not mapped** |
| Annual Report | CCI, DOS-ISRO, FIU | 3 | mapped → **Annual Report** |
| Office Memorandum | DOT, ESIC, MIB | 3 | mapped → **Office Memorandum** |
| Policy | CLC, DOS-ISRO, MIB | 3 | mapped → **Sector / National Policy Document** |
| Tender / RFP | CCI, DOS-ISRO, FIU | 3 | mapped → **Procurement Tender / RFP** |
| Gazette Notification | DOT, DST | 2 | mapped → **Gazette Notification** |
| Office Order | EPFO, ESIC | 2 | mapped → **Office Order** |
| Regulations | ESIC, MIB | 2 | mapped → **Regulations** |
| RTI Response / Disclosure | DOS-ISRO, FIU | 2 | mapped → **RTI Response / Disclosure** |
| Scheme | EPFO, MIB | 2 | mapped → **Named Government Scheme** |

#### Status — 8 names shared by 2+ regulators

| Tag name | Regulators | # | Verdict |
|---|---|---:|---|
| Amended | CCI, CLC, DOS-ISRO, DOT, DST, EPFO, ESIC, FIU, MIB, MTCTE, SARALSANCHAR | 11 | mapped → **Amended** |
| Draft / Under Consultation | CCI, CLC, DOS-ISRO, DOT, DST, EPFO, ESIC, FIU, MIB, MTCTE, SARALSANCHAR | 11 | mapped → **Draft / Under Consultation** |
| In Force | CCI, CLC, DOS-ISRO, DOT, DST, EPFO, ESIC, FIU, MIB, MTCTE, SARALSANCHAR | 11 | mapped → **In Force** |
| Superseded / Repealed | CLC, DOT, EPFO, ESIC, MIB, MTCTE, SARALSANCHAR | 7 | mapped → **Superseded / Repealed (combined)** |
| Superseded | CCI, DOS-ISRO, DST, FIU | 4 | mapped → **Superseded** |
| Not Applicable | CCI, DOS-ISRO, FIU | 3 | mapped → **Not Applicable** |
| Repealed | CCI, DOS-ISRO, FIU | 3 | mapped → **Repealed** |
| Under Litigation / Stayed | CCI, FIU | 2 | mapped → **Under Litigation / Stayed** |

The premise that "Press Release", "Annual Report", "FAQ" and "Not Applicable" match across
CCI / DOS-ISRO / FIU **holds, and extends further than expected**: Press Release is shared by six
regulators and FAQ by five. It does *not* hold universally, though — `Notification`, `Order`,
`Rules` and `Policy` all match by name across several regulators and are false cognates. See 2.3.

### 2.2 Near-duplicates — different wording, same real concept

14 of the 33 canonical concepts group tags that do **not** all share a name.
Each was confirmed by reading the regulators' own definition text.

#### Subject

**Institutional Governance & Administration**

| Regulator | Its actual tag name | Usage | Its own definition |
|---|---|---:|---|
| CCI | Institutional Governance & Administration | 3 | CCI's own internal governance, ethics, and administrative directives not tied to a specific enforcement or advocacy function. |
| CLC | Governance and Administration | 1 | CLC's own internal/administrative matters, not tied to a specific labour-law enforcement function. |
| DOS-ISRO | Institutional Governance & Administration | 36 | Internal governance of ISRO/DOS/IN-SPACe/NSIL -- Space Commission composition, leadership appointments, organisational restructuring. |
| DOT | Governance and Rulemaking | 76 | DoT's own internal/administrative matters not tied to a specific regulated sector. |
| DST | Governance and Administration | 7 | DST's own internal administrative directives not tied to a specific policy, financial, or service-condition function. |
| EPFO | Governance and Administration | 0 | EPFO's own internal/administrative matters, not tied to a specific PF policy or member-facing function. |
| ESIC | Governance and Administration | 0 | ESIC's own internal/administrative matters, not tied to hospital operations, procurement, or a specific member-facing function. |
| FIU | Institutional Governance & Administration | 0 | Internal governance of FIU-IND -- Director appointments, organisational structure, internal administrative directives. Does NOT include recruitment/vacancy/staffing content -- see 'Recruitment & Institutional Opportunities' below, split out after a real pipeline run found this Subject had become ~99% recruitment content with almost no genuine governance content in it. |
| SARALSANCHAR | Governance and Administration | 77 | Saral Sanchar's own portal-level and DoT-internal administrative matters: nodal officer appointments, portal notifications, and platform feature changes (2FA, Entity Locker integration), not tied to a specific licensing function. |

> Nine regulators, and the definitions are near-verbatim identical ('X's own internal/administrative matters, not tied to a specific ... function'). DOT's tag is named 'Governance and Rulemaking' but its definition is the same internal-administration scope, so it maps. MTCTE's identically-named 'Governance and Rulemaking' does NOT map: its definition is a mixed bucket of scheme/fee administration, meeting logistics, product-lifecycle clarifications AND DoT-level legislative Rules. See the false-cognate finding for 'Governance and Rulemaking'.

**Personnel / Establishment Matters**

| Regulator | Its actual tag name | Usage | Its own definition |
|---|---|---:|---|
| CLC | Governance and Administration > Personnel/Establishment | 5 | Transfer policy, Labour Enforcement Officer recruitment rules and work norms, internal MoUs. |
| DOT | Governance and Rulemaking > Personnel/Administration | 99 | Staff transfers, postings, promotions, retirements — routine HR/administrative notices. |
| EPFO | Governance and Administration > Personnel/Establishment | 0 | Staff transfers, postings, promotions, exam results, seniority lists, probation clearance, APAR -- routine internal HR/establishment notices. |
| ESIC | Governance and Administration > Personnel/Establishment | 0 | Office orders (promotions, transfers, DPC), gradation/seniority lists, APAR completion, contract engagement notices, sports policy, holiday circulars. |
| MIB | Ministry Internal Administration (HR/Recruitment/Establishment) | 69 | Internal ministry establishment matters: recruitment rules, vacancies, deputations, seniority, committee constitution/reconstitution, delegation of powers, and internal office administration. |

> The first four are child tags under each regulator's governance parent, with materially identical definitions. MIB's flat 'Ministry Internal Administration (HR/Recruitment/Establishment)' is a near-duplicate covering the same ground plus committee constitution and delegation of powers. DST's 'Service Conditions & Recruitment Rules' is deliberately NOT mapped: its definition scopes it to the rules and OMs governing service conditions and is explicitly 'distinct from one-off vacancy advertisements', making it a rules-about-HR subject rather than the routine HR-events bucket.

**International Cooperation**

| Regulator | Its actual tag name | Usage | Its own definition |
|---|---|---:|---|
| CCI | International Cooperation | 0 | CCI's bilateral and multilateral cooperation with foreign competition authorities and international bodies. |
| DOS-ISRO | International Cooperation | 14 | MoUs, joint working groups, and cooperation agreements with foreign space agencies and international bodies. |
| DOT | International Cooperation | 0 | ITU, APT, and other international treaty/coordination matters. |
| FIU | International Cooperation & FATF Compliance | 0 | FIU-IND's role in India's compliance with Financial Action Task Force (FATF) recommendations and cooperation with foreign financial intelligence units (the Egmont Group). |

> FIU's 'International Cooperation & FATF Compliance' is a near-duplicate that adds an FATF standards-compliance element to the same institutional-cooperation core. Three regulators have international-sounding Subjects that are deliberately NOT mapped, because in each case the subject is substantive sector regulation rather than institutional cooperation: MIB's 'International Co-production Agreements' (audio-visual co-production treaties -- a film-sector regime), EPFO's 'International Social Security Agreements' (benefit portability -- a substantive social-security regime), and DST's 'Funding Calls & Proposals (Bilateral/International)' (funding calls, not cooperation instruments).

**Procurement & Tenders**

| Regulator | Its actual tag name | Usage | Its own definition |
|---|---|---:|---|
| DOS-ISRO | Procurement & Tenders | 130 | Tenders, RFPs, and corrigenda issued by ISRO Centres and NSIL for goods, works, and services -- administrative/commercial, not rulemaking, structurally the same role as CCI's Tenders feed. |
| EPFO | Governance and Administration > Empanelment & Procurement | 2 | Empanelment of advocates, chartered accountant firms, and audit firms; tender/bid invitations. |
| ESIC | Procurement & Rate Contracts | 0 | DGESIC rate contracts for pharmaceuticals/equipment, GeM bids, corrigenda/revisions, equipment standard specifications. |
| FIU | Procurement & Tenders | 0 | Tenders and RFPs issued by FIU-IND for goods, works, and services. |

> CCI is deliberately NOT mapped even though it has procurement content, because its 'Recruitment, Procurement & Institutional Opportunities' is a single merged Subject covering BOTH procurement and staffing. Mapping it here would silently pull CCI's job vacancies into a procurement query. FIU's own seeded definition documents this exact divergence as a deliberate design decision made after a live pipeline run. ESIC's 'Litigation Management & Legal Empanelment' is also excluded: its empanelment is advocate-panel management under a litigation-policy subject, not procurement.

#### Instrument Type

**Annual Report**

| Regulator | Its actual tag name | Usage | Its own definition |
|---|---|---:|---|
| CCI | Annual Report | 0 | CCI's statutory Annual Report to Parliament. |
| DOS-ISRO | Annual Report | 28 | The annual report of ISRO, DOS, IN-SPACe, or NSIL. |
| FIU | Annual Report | 0 | FIU-IND's own annual report. |
| MIB | Annual Report / Annual Accounts | 30 | An annual report or audited annual accounts of the Ministry or an autonomous body. |

> MIB's 'Annual Report / Annual Accounts' is a near-duplicate that additionally covers audited accounts of autonomous bodies -- a superset of the same instrument form, not a different one.

**Procurement Tender / RFP**

| Regulator | Its actual tag name | Usage | Its own definition |
|---|---|---:|---|
| CCI | Tender / RFP | 16 | A procurement tender or Request for Proposal issued by CCI. |
| DOS-ISRO | Tender / RFP | 144 | A procurement tender, request for proposal, or corrigendum issued by ISRO Centres or NSIL. |
| FIU | Tender / RFP | 0 | A procurement tender or RFP issued by FIU-IND. |
| MIB | Tender Notice | 0 | A tender notice inviting bids, carrying a real tender ID and due date. |

> MIB's 'Tender Notice' is a near-duplicate with an identical scope ('carrying a real tender ID and due date').

**Primary Legislation (Act)**

| Regulator | Its actual tag name | Usage | Its own definition |
|---|---|---:|---|
| CCI | Act | 0 | The Competition Act, 2002 itself. |
| CLC | Act | 14 | The text of a labour Act itself (reference library). |
| DOS-ISRO | Act / Bill | 0 | The Space Activities Bill (draft, lapsed 2019) and any future primary legislation for the space sector. |
| DOT | Act | 0 | The Telecommunications Act itself or amendments to it. |
| FIU | Act | 0 | Primary legislation -- the Prevention of Money Laundering Act, 2002 itself. |
| MIB | Act / Amendment Act | 8 | A primary Act of Parliament or an amending Act. |

> DOS-ISRO's 'Act / Bill' additionally covers a lapsed Bill (the Space Activities Bill, 2019) that never became law -- a slightly wider scope, but the same instrument family. Flagged rather than excluded, because a Bill is the pre-enactment form of exactly this instrument.

**Recruitment / Vacancy Notice**

| Regulator | Its actual tag name | Usage | Its own definition |
|---|---|---:|---|
| CCI | Recruitment / Empanelment Notice | 3 | A job vacancy, deputation posting, or professional empanelment notice (e.g. for advocates or law firms). |
| EPFO | Advertisement | 0 | A public advertisement inviting applications, e.g. for advocate/CA-firm empanelment. |
| FIU | Recruitment / Vacancy Notice | 0 | A job vacancy, deputation posting, or contractual engagement/consultant notice issued by FIU-IND. |
| MIB | Vacancy / Recruitment Notice | 20 | A notice advertising a post, deputation, or appointment. |

> EPFO's 'Advertisement' is a near-duplicate: its definition ('a public advertisement inviting applications, e.g. for advocate/CA-firm empanelment') is the same instrument, named for the medium rather than the content.

**Public Consultation / Draft for Comments**

| Regulator | Its actual tag name | Usage | Its own definition |
|---|---|---:|---|
| CCI | Public Notice / Consultation Notice | 10 | A notice inviting public/stakeholder comments, or announcing an extended comment period, on a draft regulation or a specific case (e.g. a commitment offer). |
| DST | Draft Rules / Consultation Notice | 1 | A draft rule published specifically to solicit stakeholder comment before finalisation -- not yet operative. |
| MIB | Public Consultation / Draft for Comments | 20 | A draft instrument or consultation soliciting stakeholder comments. |
| MTCTE | Consultation | 0 | A public consultation seeking input/suggestions (e.g. on a Procedure revision). |

> Scope nuance worth knowing: CCI's tag is the NOTICE inviting comment (and also covers case-specific commitment offers), while DST's is the DRAFT INSTRUMENT itself. MIB's covers both ('a draft instrument or consultation'). Mapped as one concept because in every case the document is the consultation-stage artefact, and a cross-regulator 'what is out for comment' query wants all four.

**Office Memorandum**

| Regulator | Its actual tag name | Usage | Its own definition |
|---|---|---:|---|
| DOT | Office Memorandum | 1 | An internal administrative or procedural communication issued by DoT, as distinct from a public Notice or Order. |
| DST | Office Memorandum (OM) | 18 | An internal administrative directive or clarification issued by DST. |
| ESIC | Office Memorandum | 0 | A formal internal Office Memorandum (OM), distinct from a general Order or Notice. |
| MIB | Office Memorandum | 33 | An internal office memorandum. |

> DST's 'Office Memorandum (OM)' is the same tag with the abbreviation appended.

**Administrative Circular**

| Regulator | Its actual tag name | Usage | Its own definition |
|---|---|---:|---|
| CLC | Circular | 0 | A circular issued by CLC. |
| EPFO | Circular | 0 | A circular issued by EPFO Head Office or a Zonal/Regional Office. |
| ESIC | Circular | 0 | A circular issued by ESIC Headquarters or a field office. |
| FIU | Circular | 0 | A procedural or administrative circular issued by FIU-IND -- registration processes, reporting-format changes, and similar operational instructions to reporting entities. |
| MIB | Circular | 2 | An administrative circular. |
| MTCTE | Circular/Letter | 7 | An administrative communication not rising to the formal Notification register. |
| SARALSANCHAR | Circulars | 21 | A circular issued by DoT/Saral Sanchar communicating a procedural or compliance instruction. |

> MTCTE's 'Circular/Letter' and SARALSANCHAR's 'Circulars' are near-duplicates with the same definition. DOS-ISRO is deliberately NOT mapped here: it folded Circular into a combined 'Notification / Circular' tag, so its tag is a merged concept that would half-conflate if linked.

**Regulations**

| Regulator | Its actual tag name | Usage | Its own definition |
|---|---|---:|---|
| CCI | Regulation | 0 | A CCI-notified Regulation, whether final or in draft form for consultation. |
| ESIC | Regulations | 0 | A formal ESI Act Regulations instrument (draft or notified). |
| MIB | Regulations | 2 | Regulations governing a scheme or process, as distinct from statutory Rules made under an Act. |

> MIB's definition explicitly distinguishes Regulations from statutory Rules ('as distinct from statutory Rules made under an Act'), which is consistent with CCI and ESIC both carrying Regulation(s) alongside a separate Rules-family tag.

**Sector / National Policy Document**

| Regulator | Its actual tag name | Usage | Its own definition |
|---|---|---:|---|
| DOS-ISRO | Policy | 3 | A Cabinet- or DOS-level policy document setting sector-wide or domain-specific rules (Indian Space Policy 2023, Remote Sensing Data Policy, Spacecom Policy). |
| DST | Policy Document | 11 | A standalone national policy text, distinct from a gazette notification or an OM. |
| MIB | Policy | 7 | A stated policy document. |

> PARTIAL BY DESIGN. CLC also has a tag literally named 'Policy' and it is deliberately NOT mapped here -- CLC's is 'an internal administrative policy document, e.g. Transfer Policy', an HR instrument, not a sector policy. See the false-cognate finding for 'Policy'.

**Enforcement / Adjudicatory Order**

| Regulator | Its actual tag name | Usage | Its own definition |
|---|---|---:|---|
| CCI | CCI Order | 1221 | An adjudicatory order passed by the Commission, e.g. under Section 26(1)/26(2)/27/31/43A/44. |
| FIU | Adjudication / Penalty Order | 12 | A real, operative order by the Director FIU-IND under Section 13 PMLA imposing a monetary penalty or other sanction on a named reporting entity -- FIU-IND's core enforcement output. |

> The near-duplicate the audit set out to find, and it is genuine: FIU's own seeded definition names the equivalence ('FIU-IND's core enforcement output', and its matching Subject tag says 'structurally the closest equivalent to a CCI Order'). CCI's is Section 26(1)/26(2)/27/31/43A/44 of the Competition Act; FIU's is Section 13 PMLA. ONLY these two. The generic 'Order' tag at CLC, DOT, ESIC, MIB and SARALSANCHAR is an administrative directive, NOT an adjudicatory order, and is deliberately excluded -- see the false-cognate finding for 'Order'. No CERC, APTEL, IRDAI or SEBI regulator exists in this database, so no equivalent could be checked for them.

The enforcement-order pattern specifically called out for investigation is real, and it is
**exactly two regulators wide**: CCI's `CCI Order` (1,221 entries) and FIU's
`Adjudication / Penalty Order` (12 entries). FIU's own seeded text names the equivalence — its
matching Subject tag reads "structurally the closest equivalent to a CCI Order". No third
regulator has an adjudicatory-order instrument type. CERC, APTEL, IRDAI and SEBI are not in this
database at all, so the suggestion that they might have equivalents could not be tested.

### 2.3 False cognates — same name, different real scope

**These are NOT mapped, deliberately.** Each regulator's own Tagging Guide definition text is
reproduced verbatim so the difference is visible rather than asserted. Forcing a shared concept
onto any of these would silently merge two different scopes and make cross-regulator search
worse than no mapping at all.

#### `Notification` — Instrument Type

Five regulators use this exact name for five materially different instruments. CCI's is a Gazette/CCI notification sitting alongside a SEPARATE 'Regulation' tag. FIU's is issued by the Ministry, not by FIU-IND at all, and designates reporting-entity scope. MTCTE's deliberately absorbs the entire exemption/relaxation filing family and is its single dominant instrument type (94 of 151 real entries). EPFO's and ESIC's are generic administrative notifications. A shared concept would put a Ministry designation order, a CCI gazette notice and 94 MTCTE product-exemption filings in one bucket. Not mapped. Note also that DOS-ISRO, MIB and SARALSANCHAR each fold a different second instrument into the name, compounding the divergence.

| Regulator (and disposition) | Its actual seeded definition |
|---|---|
| CCI | A formal Gazette or CCI notification. |
| EPFO | A formal notification, e.g. of Authorised Officers under the Code on Social Security. |
| ESIC | A formal notification. |
| FIU | A Ministry (not FIU-IND itself) notification, typically designating a new category of entity as a 'reporting entity' under the Act. |
| MTCTE | A formal MTCTE notification -- phase launches, product coverage, and (deliberately) the exemption/relaxation filing family, per this file's own note above. |
| DOS-ISRO (as 'Notification / Circular') | Administrative notifications and circulars that do not themselves promulgate a Policy, NGP, or Authorization -- corrigenda, procedural updates, individual exemption notices. |
| MIB (as 'Notification / Notice') | A gazette notification or public notice. |
| SARALSANCHAR (as 'Notifications') | A formal notification, e.g. bringing specific sections of an Act into force, or notifying a new rule/scheme. |

#### `Order` — Instrument Type

The single most consequential false cognate found, because it collides with a genuine near-duplicate. At CCI and FIU an order is ADJUDICATORY -- it determines liability and imposes a penalty ('CCI Order', 'Adjudication / Penalty Order'), and those two ARE mapped together as 'Enforcement / Adjudicatory Order'. At CLC, DOT, ESIC, MIB and SARALSANCHAR a plain 'Order' is an ADMINISTRATIVE DIRECTIVE -- transfer and posting orders, a state RoW implementation order, a VDA wage order. DOT's 393 'Order' entries are overwhelmingly routine administration. Mapping 'Order' into the enforcement concept on the strength of the name would swamp a cross-regulator enforcement search with HR paperwork. The five administrative 'Order' tags are also not mapped to each other: their scopes differ among themselves, since ESIC and EPFO route internal directives to a separate 'Office Order' tag while DOT routes them into 'Order'.

| Regulator (and disposition) | Its actual seeded definition |
|---|---|
| CLC | A directive order, e.g. a VDA Order. |
| DOT | A directive order, e.g. transfer/posting orders, blocking-notification orders. |
| ESIC | A directive order not otherwise numbered as an Office Order. |
| MIB | A formal order or direction. |
| SARALSANCHAR (as 'Orders') | A directive order, most commonly a state government's order implementing a central RoW policy, or a DoT/nodal-wing administrative order. |
| CCI (as 'CCI Order') -- MAPPED to Enforcement / Adjudicatory Order | An adjudicatory order passed by the Commission, e.g. under Section 26(1)/26(2)/27/31/43A/44. |
| FIU (as 'Adjudication / Penalty Order') -- MAPPED to Enforcement / Adjudicatory Order | A real, operative order by the Director FIU-IND under Section 13 PMLA imposing a monetary penalty or other sanction on a named reporting entity -- FIU-IND's core enforcement output. |

#### `Rules` — Instrument Type

Six regulators share this exact name, but two mean something different in kind. DOT, FIU, MIB and MTCTE all define it as delegated legislation made under a primary Act -- these four ARE mapped to 'Subordinate Legislation (Rules made under an Act)'. EPFO's is 'draft or notified recruitment/service rules', which is internal HR policy with no statutory character. CLC's spans both in a single tag ('rules notified under a labour Act, OR internal service rules'), so it cannot be mapped without importing HR content into a statutory-instrument query. EPFO and CLC are left unmapped.

| Regulator (and disposition) | Its actual seeded definition |
|---|---|
| DOT -- MAPPED | Rules notified under the Telecommunications Act 2023 or its predecessor framework, e.g. '...Rules, 2026'. |
| FIU -- MAPPED | Delegated legislation made under the Act -- chiefly the Prevention of Money-Laundering (Maintenance of Records) Rules, 2005. |
| MIB -- MAPPED | Statutory rules made under an Act. |
| MTCTE -- MAPPED | Legislative Rules (Act-derived), as distinct from MTCTE's own internal Procedure document. |
| EPFO -- NOT mapped | Draft or notified recruitment/service rules. |
| CLC -- NOT mapped | Rules notified under a labour Act, or internal service rules. |

#### `Policy` — Instrument Type

CLC's 'Policy' is an internal HR instrument; DOS-ISRO's and MIB's are sector-level policy texts. These are different instruments that happen to share a word. DOS-ISRO, MIB and DST's 'Policy Document' ARE mapped together as 'Sector / National Policy Document'; CLC is not.

| Regulator (and disposition) | Its actual seeded definition |
|---|---|
| CLC -- NOT mapped | An internal administrative policy document, e.g. Transfer Policy. |
| DOS-ISRO -- MAPPED | A Cabinet- or DOS-level policy document setting sector-wide or domain-specific rules (Indian Space Policy 2023, Remote Sensing Data Policy, Spacecom Policy). |
| MIB -- MAPPED | A stated policy document. |
| DST (as 'Policy Document') -- MAPPED | A standalone national policy text, distinct from a gazette notification or an OM. |

#### `Governance and Rulemaking` — Subject

DOT and MTCTE use the identical Subject name for different scopes. DOT's is purely the institution's own internal administration, which matches the nine-regulator 'Institutional Governance & Administration' concept, and IS mapped to it. MTCTE's is a mixed residual bucket -- scheme and fee administration, meeting logistics, product end-of-life clarifications, and DoT-level legislative Rules that appear on MTCTE's own site. Mapping MTCTE here would pull statutory Rules content into an internal-administration query, so MTCTE is left unmapped.

| Regulator (and disposition) | Its actual seeded definition |
|---|---|
| DOT -- MAPPED to Institutional Governance & Administration | DoT's own internal/administrative matters not tied to a specific regulated sector. |
| MTCTE -- NOT mapped | Scheme/fee administration, meeting logistics, product-lifecycle (EoL/EoS) clarifications, and DoT-level legislative Rules referenced on MTCTE's own site. |

#### `Procurement (merged vs. split subjects)` — Subject

Not a shared name, but the same failure mode and worth recording alongside the others. CCI folds procurement and staffing into ONE Subject ('Recruitment, Procurement & Institutional Opportunities'), while FIU deliberately splits them into two. FIU's own seeded definition documents the split as a decision taken after a live pipeline run. CCI is therefore left unmapped for 'Procurement & Tenders': linking it would silently return CCI job vacancies to anyone filtering for procurement across regulators.

| Regulator (and disposition) | Its actual seeded definition |
|---|---|
| CCI (as 'Recruitment, Procurement & Institutional Opportunities') -- NOT mapped | Job vacancies, deputation postings, internship calls, tenders, RFPs, and empanelment notices issued by CCI. |
| DOS-ISRO -- MAPPED | Tenders, RFPs, and corrigenda issued by ISRO Centres and NSIL for goods, works, and services -- administrative/commercial, not rulemaking, structurally the same role as CCI's Tenders feed. |
| FIU (as 'Procurement & Tenders') -- MAPPED | Tenders and RFPs issued by FIU-IND for goods, works, and services. |
| FIU (as 'Recruitment & Institutional Opportunities') -- separate Subject, NOT mapped to procurement | Job vacancies, deputation postings, and contractual staff/consultant engagement notices issued by FIU-IND -- kept as its own Subject rather than folded into Institutional Governance & Administration or merged into Procurement & Tenders (unlike CCI's equivalent combined Subject). |

#### `International Cooperation (sector regimes sharing the word)` — Subject

CCI, DOS-ISRO, DOT and FIU all use this Subject for institutional cooperation with foreign counterparts, and those four ARE mapped. Three other regulators have international-sounding Subjects that are substantive sector regulation, not cooperation, and are deliberately not mapped -- treating them as the same concept would put film co-production treaties and social-security benefit portability into an institutional-cooperation query.

| Regulator (and disposition) | Its actual seeded definition |
|---|---|
| CCI -- MAPPED | CCI's bilateral and multilateral cooperation with foreign competition authorities and international bodies. |
| DOS-ISRO -- MAPPED | MoUs, joint working groups, and cooperation agreements with foreign space agencies and international bodies. |
| DOT -- MAPPED | ITU, APT, and other international treaty/coordination matters. |
| FIU (as 'International Cooperation & FATF Compliance') -- MAPPED | FIU-IND's role in India's compliance with Financial Action Task Force (FATF) recommendations and cooperation with foreign financial intelligence units (the Egmont Group). |
| MIB (as 'International Co-production Agreements') -- NOT mapped | Bilateral audio-visual co-production treaties and agreements between India and foreign governments. |
| EPFO (as 'International Social Security Agreements') -- NOT mapped | Bilateral social security / totalization agreements between India and other countries. |
| DST (as 'Funding Calls & Proposals (Bilateral/International)') -- NOT mapped | Calls for joint research proposals under DST's bilateral and multilateral STI cooperation agreements, administered by the International Cooperation Division (mostly hosted on aistic.gov.in). |

---

## 3. The schema addition

`CanonicalConcept` (migration `20260907075608_add_canonical_concept`) plus a **nullable**
`TaxonomyTag.canonicalConceptId` foreign key with `ON DELETE SET NULL`.

```prisma
model CanonicalConcept {
  id         String        @id @default(cuid())
  facet      Facet         // SUBJECT | INSTRUMENT_TYPE | STATUS
  name       String
  definition String
  notes      String?       // why borderline regulators were in- or excluded
  createdAt  DateTime      @default(now())
  tags       TaxonomyTag[]

  @@unique([facet, name])
  @@index([facet])
}
```

The migration is purely additive: one new table, one nullable column, two indexes and one
foreign key. No existing row was modified, renamed, merged or deleted, and no regulator's own
taxonomy changed in any way.

The `facet` field reuses the existing `Facet` enum rather than a free-text string, so a concept
cannot be created against a facet that does not exist, and a Subject concept cannot accidentally
be linked to an Instrument Type tag.

## 4. Canonical concepts created

**33 concepts, linking 153 of 310 tags (49%).**
The remaining 157 tags map to nothing. That is the correct outcome, not a backlog:
most Subject tags are irreducibly regulator-specific (`Abuse of Dominant Position`,
`SACFA Clearances`, `Sports Broadcasting Signal Sharing (Prasar Bharati)`), and the tags in
section 2.3 are unmapped on purpose.

| Facet | Concepts | Tags mapped | Tags total | % |
|---|---:|---:|---:|---:|
| Subject | 6 | 27 | 131 | 21% |
| Instrument Type | 19 | 74 | 124 | 60% |
| Status | 8 | 52 | 55 | 95% |
| **Total** | **33** | **153** | **310** | **49%** |

### Subject — 6 concepts

#### Institutional Governance & Administration

_The institution's own internal governance and administrative matters -- leadership appointments, organisational structure, and internal directives not tied to any specific regulated function._

| Regulator | Its tag | Usage |
|---|---|---:|
| CCI | Institutional Governance & Administration | 3 |
| CLC | Governance and Administration | 1 |
| DOS-ISRO | Institutional Governance & Administration | 36 |
| DOT | Governance and Rulemaking | 76 |
| DST | Governance and Administration | 7 |
| EPFO | Governance and Administration | 0 |
| ESIC | Governance and Administration | 0 |
| FIU | Institutional Governance & Administration | 0 |
| SARALSANCHAR | Governance and Administration | 77 |

> **Why these and not others.** Nine regulators, and the definitions are near-verbatim identical ('X's own internal/administrative matters, not tied to a specific ... function'). DOT's tag is named 'Governance and Rulemaking' but its definition is the same internal-administration scope, so it maps. MTCTE's identically-named 'Governance and Rulemaking' does NOT map: its definition is a mixed bucket of scheme/fee administration, meeting logistics, product-lifecycle clarifications AND DoT-level legislative Rules. See the false-cognate finding for 'Governance and Rulemaking'.

#### International Cooperation

_The institution's own bilateral and multilateral cooperation with foreign counterpart authorities and international bodies -- MoUs, joint working groups, treaty coordination, and international standard-setting participation._

| Regulator | Its tag | Usage |
|---|---|---:|
| CCI | International Cooperation | 0 |
| DOS-ISRO | International Cooperation | 14 |
| DOT | International Cooperation | 0 |
| FIU | International Cooperation & FATF Compliance | 0 |

> **Why these and not others.** FIU's 'International Cooperation & FATF Compliance' is a near-duplicate that adds an FATF standards-compliance element to the same institutional-cooperation core. Three regulators have international-sounding Subjects that are deliberately NOT mapped, because in each case the subject is substantive sector regulation rather than institutional cooperation: MIB's 'International Co-production Agreements' (audio-visual co-production treaties -- a film-sector regime), EPFO's 'International Social Security Agreements' (benefit portability -- a substantive social-security regime), and DST's 'Funding Calls & Proposals (Bilateral/International)' (funding calls, not cooperation instruments).

#### Official Language (Rajbhasha)

_Hindi-language promotion and Official Language implementation -- Hindi Diwas/Pakhwada, Rajbhasha committee matters, and Hindi implementation directives._

| Regulator | Its tag | Usage |
|---|---|---:|
| EPFO | Governance and Administration > Official Language (Rajbhasha) | 0 |
| ESIC | Governance and Administration > Official Language (Rajbhasha) | 0 |

#### Personnel / Establishment Matters

_Routine internal HR and establishment business -- transfers, postings, promotions, seniority and gradation lists, probation and APAR, and recruitment/service rules for the institution's own staff._

| Regulator | Its tag | Usage |
|---|---|---:|
| CLC | Governance and Administration > Personnel/Establishment | 5 |
| DOT | Governance and Rulemaking > Personnel/Administration | 99 |
| EPFO | Governance and Administration > Personnel/Establishment | 0 |
| ESIC | Governance and Administration > Personnel/Establishment | 0 |
| MIB | Ministry Internal Administration (HR/Recruitment/Establishment) | 69 |

> **Why these and not others.** The first four are child tags under each regulator's governance parent, with materially identical definitions. MIB's flat 'Ministry Internal Administration (HR/Recruitment/Establishment)' is a near-duplicate covering the same ground plus committee constitution and delegation of powers. DST's 'Service Conditions & Recruitment Rules' is deliberately NOT mapped: its definition scopes it to the rules and OMs governing service conditions and is explicitly 'distinct from one-off vacancy advertisements', making it a rules-about-HR subject rather than the routine HR-events bucket.

#### Procurement & Tenders

_The institution's procurement of goods, works, and services -- tenders, RFPs, rate contracts, bid invitations, and professional empanelment for procurement purposes._

| Regulator | Its tag | Usage |
|---|---|---:|
| DOS-ISRO | Procurement & Tenders | 130 |
| EPFO | Governance and Administration > Empanelment & Procurement | 2 |
| ESIC | Procurement & Rate Contracts | 0 |
| FIU | Procurement & Tenders | 0 |

> **Why these and not others.** CCI is deliberately NOT mapped even though it has procurement content, because its 'Recruitment, Procurement & Institutional Opportunities' is a single merged Subject covering BOTH procurement and staffing. Mapping it here would silently pull CCI's job vacancies into a procurement query. FIU's own seeded definition documents this exact divergence as a deliberate design decision made after a live pipeline run. ESIC's 'Litigation Management & Legal Empanelment' is also excluded: its empanelment is advocate-panel management under a litigation-policy subject, not procurement.

#### Public Information & Transparency (RTI)

_RTI disclosures and public-transparency material published under the Right to Information Act._

| Regulator | Its tag | Usage |
|---|---|---:|
| CCI | Public Information & Transparency | 0 |
| DOS-ISRO | Public Information & Transparency | 5 |
| FIU | Public Information & Transparency | 0 |

### Instrument Type — 19 concepts

#### Administrative Circular

_A procedural or administrative circular issued by the institution to communicate an operational or compliance instruction, not rising to the formal notification register._

| Regulator | Its tag | Usage |
|---|---|---:|
| CLC | Circular | 0 |
| EPFO | Circular | 0 |
| ESIC | Circular | 0 |
| FIU | Circular | 0 |
| MIB | Circular | 2 |
| MTCTE | Circular/Letter | 7 |
| SARALSANCHAR | Circulars | 21 |

> **Why these and not others.** MTCTE's 'Circular/Letter' and SARALSANCHAR's 'Circulars' are near-duplicates with the same definition. DOS-ISRO is deliberately NOT mapped here: it folded Circular into a combined 'Notification / Circular' tag, so its tag is a merged concept that would half-conflate if linked.

#### Annual Report

_The institution's own periodic annual report or audited annual accounts._

| Regulator | Its tag | Usage |
|---|---|---:|
| CCI | Annual Report | 0 |
| DOS-ISRO | Annual Report | 28 |
| FIU | Annual Report | 0 |
| MIB | Annual Report / Annual Accounts | 30 |

> **Why these and not others.** MIB's 'Annual Report / Annual Accounts' is a near-duplicate that additionally covers audited accounts of autonomous bodies -- a superset of the same instrument form, not a different one.

#### Corrigendum

_A correction notice issued against a previously published document._

| Regulator | Its tag | Usage |
|---|---|---:|
| CLC | Corrigendum | 3 |
| DOT | Corrigendum | 7 |
| EPFO | Corrigendum | 0 |
| ESIC | Corrigendum | 0 |
| MIB | Corrigendum | 7 |

> **Why these and not others.** Exact name match; all five definitions are near-verbatim identical. MIB's own seeded note records that it kept Corrigendum as its own type while MTCTE folded its single corrigendum into Notification -- which is why MTCTE has no tag to map here.

#### Enforcement / Adjudicatory Order

_An adjudicatory order passed by the regulator itself that determines liability and/or imposes a monetary penalty or sanction on a named party._

| Regulator | Its tag | Usage |
|---|---|---:|
| CCI | CCI Order | 1221 |
| FIU | Adjudication / Penalty Order | 12 |

> **Why these and not others.** The near-duplicate the audit set out to find, and it is genuine: FIU's own seeded definition names the equivalence ('FIU-IND's core enforcement output', and its matching Subject tag says 'structurally the closest equivalent to a CCI Order'). CCI's is Section 26(1)/26(2)/27/31/43A/44 of the Competition Act; FIU's is Section 13 PMLA. ONLY these two. The generic 'Order' tag at CLC, DOT, ESIC, MIB and SARALSANCHAR is an administrative directive, NOT an adjudicatory order, and is deliberately excluded -- see the false-cognate finding for 'Order'. No CERC, APTEL, IRDAI or SEBI regulator exists in this database, so no equivalent could be checked for them.

#### FAQ

_A static frequently-asked-questions document explaining a procedure or compliance obligation._

| Regulator | Its tag | Usage |
|---|---|---:|
| CCI | FAQ | 0 |
| CLC | FAQ | 4 |
| DOS-ISRO | FAQ | 1 |
| FIU | FAQ | 0 |
| MTCTE | FAQ | 1 |

> **Why these and not others.** Exact name match; all five definitions are materially identical.

#### Gazette Notification

_A notification published in the Official Gazette of India._

| Regulator | Its tag | Usage |
|---|---|---:|
| DOT | Gazette Notification | 25 |
| DST | Gazette Notification | 5 |

> **Why these and not others.** Deliberately kept separate from the plain 'Notification' name, which is a confirmed false cognate. 'Gazette Notification' is unambiguous: both definitions pin it to Gazette publication.

#### Guidelines

_Non-statutory but operative guidance issued by the institution -- requirements, procedures, SOPs, or a code of conduct that is less formally binding than a Rule._

| Regulator | Its tag | Usage |
|---|---|---:|
| DOT | Guidelines | 5 |
| DST | Guidelines | 13 |
| ESIC | Guidelines | 0 |
| FIU | Guidelines | 0 |
| MIB | Guidelines | 23 |

> **Why these and not others.** Exact name match across five. DST's definition states the shared boundary most explicitly ('less formally binding than a Rule but still an operative standard') and FIU's states the negative boundary ('distinct from a Circular and a Notification'). Both are consistent with the other three.

#### Named Government Scheme

_A named government scheme document._

| Regulator | Its tag | Usage |
|---|---|---:|
| EPFO | Scheme | 0 |
| MIB | Scheme | 5 |

> **Why these and not others.** EPFO's is narrower in practice (its examples are amnesty/settlement schemes: 'AMNESTY, 2026', 'VISHWAS, 2026') and MIB's is the general form. Mapped because EPFO's is a strict subset of the same instrument form -- the difference is subject matter, which the Subject facet already carries -- but the narrowing is recorded here so a reader is not surprised by what EPFO returns.

#### Office Memorandum

_An internal administrative or procedural communication issued within the institution, distinct from a public Notice or Order._

| Regulator | Its tag | Usage |
|---|---|---:|
| DOT | Office Memorandum | 1 |
| DST | Office Memorandum (OM) | 18 |
| ESIC | Office Memorandum | 0 |
| MIB | Office Memorandum | 33 |

> **Why these and not others.** DST's 'Office Memorandum (OM)' is the same tag with the abbreviation appended.

#### Office Order

_A sequentially-numbered internal directive order covering transfers, postings, and charge assignments._

| Regulator | Its tag | Usage |
|---|---|---:|
| EPFO | Office Order | 0 |
| ESIC | Office Order | 0 |

> **Why these and not others.** Only EPFO and ESIC carry this as a distinct instrument type. Note the interaction with the 'Order' false cognate: at these two regulators internal directives go here, which is precisely why their 'Order' tag means something narrower than DOT's.

#### Press Release

_A public communications release issued by the institution to announce an action, decision, milestone, or event._

| Regulator | Its tag | Usage |
|---|---|---:|
| CCI | Press Release | 14 |
| DOS-ISRO | Press Release | 140 |
| DOT | Press Release | 62 |
| FIU | Press Release | 0 |
| MIB | Press Release | 462 |
| SARALSANCHAR | Press Release | 4 |

> **Why these and not others.** Exact name match across all six. Every definition is the same instrument form; the subject matter differs (combination approvals at CCI, mission milestones at DOS-ISRO), but subject matter is what the Subject facet carries.

#### Primary Legislation (Act)

_The text of a primary Act of Parliament governing the institution's domain, or an amending Act._

| Regulator | Its tag | Usage |
|---|---|---:|
| CCI | Act | 0 |
| CLC | Act | 14 |
| DOS-ISRO | Act / Bill | 0 |
| DOT | Act | 0 |
| FIU | Act | 0 |
| MIB | Act / Amendment Act | 8 |

> **Why these and not others.** DOS-ISRO's 'Act / Bill' additionally covers a lapsed Bill (the Space Activities Bill, 2019) that never became law -- a slightly wider scope, but the same instrument family. Flagged rather than excluded, because a Bill is the pre-enactment form of exactly this instrument.

#### Procurement Tender / RFP

_A procurement tender or request for proposal inviting bids for goods, works, or services._

| Regulator | Its tag | Usage |
|---|---|---:|
| CCI | Tender / RFP | 16 |
| DOS-ISRO | Tender / RFP | 144 |
| FIU | Tender / RFP | 0 |
| MIB | Tender Notice | 0 |

> **Why these and not others.** MIB's 'Tender Notice' is a near-duplicate with an identical scope ('carrying a real tender ID and due date').

#### Public Consultation / Draft for Comments

_A document published at the consultation stage to solicit stakeholder comment before an instrument is finalised._

| Regulator | Its tag | Usage |
|---|---|---:|
| CCI | Public Notice / Consultation Notice | 10 |
| DST | Draft Rules / Consultation Notice | 1 |
| MIB | Public Consultation / Draft for Comments | 20 |
| MTCTE | Consultation | 0 |

> **Why these and not others.** Scope nuance worth knowing: CCI's tag is the NOTICE inviting comment (and also covers case-specific commitment offers), while DST's is the DRAFT INSTRUMENT itself. MIB's covers both ('a draft instrument or consultation'). Mapped as one concept because in every case the document is the consultation-stage artefact, and a cross-regulator 'what is out for comment' query wants all four.

#### RTI Response / Disclosure

_Suo-motu disclosures and Right to Information responses published under the institution's RTI obligations._

| Regulator | Its tag | Usage |
|---|---|---:|
| DOS-ISRO | RTI Response / Disclosure | 0 |
| FIU | RTI Response / Disclosure | 0 |

#### Recruitment / Vacancy Notice

_A notice advertising a post, deputation, contractual engagement, or professional empanelment._

| Regulator | Its tag | Usage |
|---|---|---:|
| CCI | Recruitment / Empanelment Notice | 3 |
| EPFO | Advertisement | 0 |
| FIU | Recruitment / Vacancy Notice | 0 |
| MIB | Vacancy / Recruitment Notice | 20 |

> **Why these and not others.** EPFO's 'Advertisement' is a near-duplicate: its definition ('a public advertisement inviting applications, e.g. for advocate/CA-firm empanelment') is the same instrument, named for the medium rather than the content.

#### Regulations

_A Regulation instrument made by the institution under its parent Act, whether in draft or notified form._

| Regulator | Its tag | Usage |
|---|---|---:|
| CCI | Regulation | 0 |
| ESIC | Regulations | 0 |
| MIB | Regulations | 2 |

> **Why these and not others.** MIB's definition explicitly distinguishes Regulations from statutory Rules ('as distinct from statutory Rules made under an Act'), which is consistent with CCI and ESIC both carrying Regulation(s) alongside a separate Rules-family tag.

#### Sector / National Policy Document

_A standalone sector-wide or national policy text setting policy for a domain, as distinct from a gazette notification, a rule, or an internal memorandum._

| Regulator | Its tag | Usage |
|---|---|---:|
| DOS-ISRO | Policy | 3 |
| DST | Policy Document | 11 |
| MIB | Policy | 7 |

> **Why these and not others.** PARTIAL BY DESIGN. CLC also has a tag literally named 'Policy' and it is deliberately NOT mapped here -- CLC's is 'an internal administrative policy document, e.g. Transfer Policy', an HR instrument, not a sector policy. See the false-cognate finding for 'Policy'.

#### Subordinate Legislation (Rules made under an Act)

_Delegated legislation made under a primary Act -- statutory Rules with the force of law._

| Regulator | Its tag | Usage |
|---|---|---:|
| DOT | Rules | 40 |
| FIU | Rules | 0 |
| MIB | Rules | 15 |
| MTCTE | Rules | 2 |

> **Why these and not others.** PARTIAL BY DESIGN, and the most important partial mapping in this table. Six regulators have a tag named exactly 'Rules', but only these four define it as Act-derived delegated legislation. EPFO's 'Rules' is 'draft or notified recruitment/service rules' -- internal HR rules, not delegated legislation -- and CLC's spans both ('rules notified under a labour Act, OR internal service rules'). Both are left unmapped. See the false-cognate finding for 'Rules'.

### Status — 8 concepts

#### Amended

_The base instrument remains in force but has been modified by a subsequent amending document._

| Regulator | Its tag | Usage |
|---|---|---:|
| CCI | Amended | 1 |
| CLC | Amended | 0 |
| DOS-ISRO | Amended | 9 |
| DOT | Amended | 1 |
| DST | Amended | 0 |
| EPFO | Amended | 0 |
| ESIC | Amended | 0 |
| FIU | Amended | 0 |
| MIB | Amended | 2 |
| MTCTE | Amended | 1 |
| SARALSANCHAR | Amended | 0 |

> **Why these and not others.** All 11 regulators, exact name match, definitions materially identical. As with 'In Force', DST scopes this to 6 of its 9 Subjects via statusAppliesToSubjectIds; every other regulator applies it to all Subjects.

#### Draft / Under Consultation

_Published for stakeholder comment or otherwise unfinalised; not yet operative._

| Regulator | Its tag | Usage |
|---|---|---:|
| CCI | Draft / Under Consultation | 1 |
| CLC | Draft / Under Consultation | 0 |
| DOS-ISRO | Draft / Under Consultation | 2 |
| DOT | Draft / Under Consultation | 25 |
| DST | Draft / Under Consultation | 1 |
| EPFO | Draft / Under Consultation | 0 |
| ESIC | Draft / Under Consultation | 0 |
| FIU | Draft / Under Consultation | 0 |
| MIB | Draft / Under Consultation | 19 |
| MTCTE | Draft / Under Consultation | 0 |
| SARALSANCHAR | Draft / Under Consultation | 0 |

> **Why these and not others.** All 11 regulators, exact name match. DOS-ISRO and FIU add the same negative carve-out (not for outreach/press content), which narrows application but not the concept. DST again scopes this to 6 of its 9 Subjects.

#### In Force

_The instrument is the current, legally or administratively operative version._

| Regulator | Its tag | Usage |
|---|---|---:|
| CCI | In Force | 1317 |
| CLC | In Force | 33 |
| DOS-ISRO | In Force | 394 |
| DOT | In Force | 566 |
| DST | In Force | 46 |
| EPFO | In Force | 5 |
| ESIC | In Force | 0 |
| FIU | In Force | 12 |
| MIB | In Force | 1021 |
| MTCTE | In Force | 139 |
| SARALSANCHAR | In Force | 380 |

> **Why these and not others.** All 11 regulators, exact name match, and 9 of 11 definitions are verbatim identical. The two that differ (DOS-ISRO, FIU) only append regulator-specific examples to the same rule. ONE ASYMMETRY WORTH KNOWING: DST is the only regulator that scopes this value via statusAppliesToSubjectIds -- its 'In Force' is valid for only 6 of its 9 Subjects, and is a category error on its three Funding Calls Subjects, which use Open/Closed/Results Announced instead. Everywhere else 'In Force' applies to every Subject. The concept is the same; DST's applicability is narrower.

#### Not Applicable

_The Status facet does not meaningfully describe this content -- outreach, education, and event material that is not itself a regulatory instrument with a lifecycle._

| Regulator | Its tag | Usage |
|---|---|---:|
| CCI | Not Applicable | 1 |
| DOS-ISRO | Not Applicable | 152 |
| FIU | Not Applicable | 0 |

> **Why these and not others.** FIU's seeded definition records that it was 'adopted directly from CCI's v1.3 correction', which is direct evidence of a deliberate shared concept rather than coincidence. Application guidance does differ at the edges and is worth knowing: CCI explicitly excludes tenders, RFPs and market studies from this value, while FIU explicitly includes its own Annual Report. The concept is the same; the boundary each regulator draws is not identical.

#### Repealed

_The instrument has been formally withdrawn without a direct like-for-like successor._

| Regulator | Its tag | Usage |
|---|---|---:|
| CCI | Repealed | 0 |
| DOS-ISRO | Repealed | 2 |
| FIU | Repealed | 0 |

> **Why these and not others.** Same four-versus-seven split as 'Superseded'; CCI, DOS-ISRO and FIU carry this as a distinct value.

#### Superseded

_The instrument has been fully replaced by a later version of the same instrument._

| Regulator | Its tag | Usage |
|---|---|---:|
| CCI | Superseded | 0 |
| DOS-ISRO | Superseded | 2 |
| DST | Superseded | 0 |
| FIU | Superseded | 0 |

> **Why these and not others.** Only the four regulators that distinguish supersession from repeal. The other seven use a single combined tag -- mapped to its own concept below rather than forced in here. DST scopes its 'Superseded' to 6 of its 9 Subjects.

#### Superseded / Repealed (combined)

_A later instrument has formally replaced this one, or it has been withdrawn; it is no longer operative. This is deliberately the UNION of the separate 'Superseded' and 'Repealed' concepts, used by the seven regulators whose taxonomies do not draw that distinction._

| Regulator | Its tag | Usage |
|---|---|---:|
| CLC | Superseded / Repealed | 17 |
| DOT | Superseded / Repealed | 0 |
| EPFO | Superseded / Repealed | 0 |
| ESIC | Superseded / Repealed | 0 |
| MIB | Superseded / Repealed | 1 |
| MTCTE | Superseded / Repealed | 11 |
| SARALSANCHAR | Superseded / Repealed | 0 |

> **Why these and not others.** Kept as its own concept rather than merged into 'Superseded' or 'Repealed' precisely because it is coarser. Merging would tell a reader that CLC's 17 'Superseded / Repealed' documents are all supersessions, which the data does not say. A cross-regulator 'no longer operative' query should union all three of these concepts.

#### Under Litigation / Stayed

_The instrument's or order's validity is subject to an ongoing appeal or has been stayed by a tribunal or court._

| Regulator | Its tag | Usage |
|---|---|---:|
| CCI | Under Litigation / Stayed | 0 |
| FIU | Under Litigation / Stayed | 0 |

> **Why these and not others.** FIU's seeded definition states the borrowing outright: 'Naming reused from CCI's identical Status tag for cross-regulator consistency.' CCI's route is NCLAT/Supreme Court, FIU's is the Section 26 PMLA Appellate Tribunal.

---

## 5. Should Status be a shared enum instead of a mapping table?

The task asked for this to be evaluated for Status specifically, on the real data, rather than
applying the mapping-table pattern uniformly to all three facets. The convergence is real:

- 55 Status tags exist across 11 regulators — an average of 5.0 each, against
  11.9 Subject tags each.
- Three values (`In Force`, `Amended`, `Draft / Under Consultation`) are present at **all 11**
  regulators, by exact name, with near-verbatim identical definitions.
- 52 of 55 Status tags (95%) map to a shared concept.

**Recommendation: keep the mapping table for Status too. Do not convert it to an enum.**

Three things in the real data defeat the enum:

1. **DST already broke the enum once, and the schema records it.** DST's Funding Calls use
   `Open / Accepting Applications`, `Closed / Applications Closed` and `Results Announced` —
   645 entries between them, more than DST's `In Force` count. A global `DocumentStatus` enum is
   exactly what the schema *used to* have; it was removed in migration
   `20260817080000_drop_legacy_document_status_enum` precisely because DST needed these values.
   Reintroducing an enum would re-create the problem that migration solved.

2. **The supersession concept is genuinely two different granularities.** Seven regulators use a
   single combined `Superseded / Repealed`; four use a separate `Superseded`, and three of those
   also carry a distinct `Repealed`. An enum forces a choice: either drop the distinction that
   CCI, DOS-ISRO, DST and FIU deliberately make, or add both values and misrepresent the seven
   regulators that never draw it. The mapping table represents this honestly with three concepts
   (`Superseded`, `Repealed`, `Superseded / Repealed (combined)`), the third documented as the
   union of the other two.

3. **`statusAppliesToSubjectIds` has no enum equivalent, and it is already load-bearing.** A
   Status tag can be scoped to specific Subjects of the same regulator, and both the
   classification prompt and `lib/ingest.ts` read the field. Checked against the live database,
   **all seven of DST's Status tags are scoped this way** — not just its three funding-call
   values. DST's `In Force` is valid for only 6 of its 9 Subjects and is a category error on the
   three Funding Calls Subjects, which use `Open` / `Closed` / `Results Announced` instead. So
   even the three values that all 11 regulators genuinely share do **not** mean "applies to
   everything" at DST. An enum value is a bare symbol with nowhere to hang that scoping; the
   mapping table leaves it on the tag, where it already works.

The mapping table already delivers the benefit an enum was wanted for: a cross-regulator
"everything currently in force" query is `WHERE canonicalConcept.name = 'In Force'`, and it
works across all 11 regulators today. It does so without discarding DST's lifecycle, without
flattening the supersession distinction, and without another destructive migration.

---

## 6. Verification

There is no test suite in this repo (`package.json` defines no `test` script and there is no
test directory), so verification was done by snapshot comparison against the live database.

`scripts/.audit/snapshot.ts` executes the real query layer in `lib/queries.ts` — the same
functions the public wiki and the admin review UI call — and SHA-256 hashes each result. It was
run before the migration and again after the migration and the mapping were applied. It covers:

- `getRegulators`, `getDomainOverview`, `getPublicCountsByRegulator`, `getFlaggedCountsByRegulator`
- `getTagsByFacet` for Subject and Instrument Type
- `getRegulatorDetail`, `getTagOptions`, `listPublicEntries` and `listFlaggedEntries` for each of the 11 regulators
- `listPublicEntries` filtered by **every single tag**, for all three facets — Subject and
  Instrument Type through the real query functions, Status through `statusId` directly
- `getTag` for every Subject and Instrument Type tag

615 query results in total. The result is recorded in section 6.1.

**What this does and does not prove.** `lib/queries.ts` uses explicit narrow `select` shapes
everywhere (`ENTRY_LIST_SELECT` and friends), so the new `canonicalConceptId` column never
enters any of these payloads — which is itself part of why the change is safe. What the
comparison therefore verifies is the thing that actually matters for this step: the *entries
returned*, their *ordering*, their *counts* and the *tag option lists* are identical for every
tag at every regulator. It would have caught a filter returning different documents, a tag
disappearing from a dropdown, or a count shifting. It is not a claim that the column is absent
from the schema — it is there, and unused by the existing read path, by design.

Reproduce with:

```bash
npx tsx scripts/.audit/snapshot.ts before   # (pre-migration)
npx tsx scripts/.audit/snapshot.ts after
npx tsx scripts/.audit/compare-snapshots.ts
```

### 6.1 Result

**PASS.** All 615 query results are byte-identical before and after the migration.

Nothing about how any single regulator's own tags behave changed. Subject, Instrument Type
and Status filtering return exactly the same entries, in the same order, for every tag at
every regulator. The mapping layer is purely additive, as intended.

---

## 7. How to regenerate this report

All mapping decisions live in one file, `scripts/canonical-concepts.data.ts`. The database rows,
this report and the Excel workbook are all generated from it, so they cannot disagree:

```bash
npx tsx scripts/populate-canonical-concepts.ts --dry-run  # validate every tag name resolves
npx tsx scripts/populate-canonical-concepts.ts            # write CanonicalConcept + links
npx tsx scripts/build-taxonomy-findings.ts                # export live data -> .audit/findings.json
npx tsx scripts/build-taxonomy-report.ts                  # this file
python scripts/build-taxonomy-workbook.py                 # taxonomy-canonical-concepts.xlsx
```

`build-taxonomy-findings.ts` refuses to export if the database and the mapping data file
disagree, and `populate-canonical-concepts.ts` refuses to write if any tag name in the data file
does not resolve to a real seeded tag.

**If a mapping decision changes, change it in `canonical-concepts.data.ts` and re-run all five
steps.** Do not edit this file or the workbook by hand — both are generated artefacts.
