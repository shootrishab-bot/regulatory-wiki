/**
 * Renders taxonomy-canonical-concepts.md from scripts/.audit/findings.json.
 * Reads nothing else, and re-derives nothing -- see build-taxonomy-findings.ts.
 */
import { readFileSync, writeFileSync } from "fs";

interface Findings {
  generatedAt: string;
  regulators: { code: string; name: string; domain: string }[];
  liveVersions: { regulator: string; version: string; entries: number }[];
  tags: {
    regulator: string; facet: string; tag: string; short_code: string; tag_status: string;
    version_added: string | null; definition: string | null; notes: string | null;
    usage_count: number; concept: string | null;
  }[];
  concepts: {
    facet: string; name: string; definition: string; notes: string | null;
    tags: { regulator: string; tag: string }[];
  }[];
  exactMatches: Record<string, { name: string; regulators: string[]; mappedTo: string | null }[]>;
  nearDuplicates: {
    facet: string; concept: string; definition: string; notes: string | null;
    variants: { regulator: string; tag: string; usage: number; definition: string | null }[];
  }[];
  falseCognates: { facet: string; tagName: string; verdict: string; definitions: Record<string, string> }[];
}

const f: Findings = JSON.parse(readFileSync("scripts/.audit/findings.json", "utf8"));

const FACET_LABEL: Record<string, string> = {
  SUBJECT: "Subject",
  INSTRUMENT_TYPE: "Instrument Type",
  STATUS: "Status",
};
const FACET_ORDER = ["SUBJECT", "INSTRUMENT_TYPE", "STATUS"];
const CODES = f.regulators.map((r) => r.code);
/** Escape a pipe so it cannot break out of a markdown table cell. */
const esc = (s: string | null | undefined) => (s ?? "").replace(/\|/g, "\\|").replace(/\r?\n/g, " ");

const L: string[] = [];
const p = (s = "") => L.push(s);

// ---------------------------------------------------------------------------
p("# Cross-Regulator Taxonomy Audit and Canonical Concept Mapping");
p();
p(`Generated from the live Neon Postgres database on ${f.generatedAt.slice(0, 10)}.`);
p();
p("Every number and every definition quoted below was read directly out of `TaxonomyTag`,");
p("`UpdateEntry` and `CanonicalConcept`. Nothing here comes from the taxonomy workbooks in");
p("the repo — see Finding A, which is the reason that distinction matters.");
p();
p("---");
p();

// --- Headline findings -----------------------------------------------------
p("## Headline findings");
p();
const versionSet = [...new Set(f.liveVersions.map((v) => v.version))];
const totalEntries = f.liveVersions.reduce((n, v) => n + v.entries, 0);
p(`**A. Every live \`UpdateEntry\` row is tagged \`taxonomyVersion = "v1.0"\` — all ${totalEntries.toLocaleString()} of them, at every regulator.**`);
p(`There is no other value in the column (\`${versionSet.join("`, `")}\`). This contradicts what the`);
p("taxonomy workbooks in the repo imply. Individual *tags* do carry later `versionAdded` values —");
p("CCI's `Not Applicable` Status tag is marked `v1.3`, and all 24 of DST's tags are marked `v2.0` —");
p("but no entry has ever been re-tagged against those versions. FIU's own seeded definition for");
p("`Not Applicable` even cites \"CCI's v1.3 correction\" as its source. So the workbook version and");
p("the live entry version are two different things, and only the tag-level `versionAdded` field");
p("reflects taxonomy revisions at all.");
p();
p("**Practical consequence:** a reader cannot use `UpdateEntry.taxonomyVersion` to tell which");
p("taxonomy revision an entry was classified against. It is currently a constant.");
p();
const esicTags = f.tags.filter((t) => t.regulator === "ESIC").length;
p(`**B. ESIC has a complete seeded taxonomy (${esicTags} tags) and zero documents.**`);
p("It has no `SourceDocument` and no `UpdateEntry` rows at all, so it has no live taxonomy version.");
p("Its tags are included in the mapping below because the vocabulary is real and seeded, but every");
p("ESIC usage count in this report is a genuine zero, not a small number.");
p();
const zero = f.tags.filter((t) => t.usage_count === 0).length;
p(`**C. ${zero} of ${f.tags.length} tags (${Math.round((zero / f.tags.length) * 100)}%) have never been applied to a single entry.**`);
p("Excluding ESIC's 23, that is still " + (zero - esicTags) + " unused tags at regulators that do have documents —");
p("for example FIU, which has 31 tags and only 12 entries. A zero-usage tag says something different");
p("from a heavily-used one, so the inventory below reports usage for every tag rather than only");
p("listing vocabulary.");
p();
p("**D. The Status facet has converged almost completely; Subject has barely converged at all.**");
const mappedByFacet = (facet: string) => f.tags.filter((t) => t.facet === facet && t.concept).length;
const totalByFacet = (facet: string) => f.tags.filter((t) => t.facet === facet).length;
p(`All 11 regulators share \`In Force\`, \`Amended\` and \`Draft / Under Consultation\` by exact name,`);
p(`with near-verbatim identical definitions. ${mappedByFacet("STATUS")} of ${totalByFacet("STATUS")} Status tags map to a shared concept`);
p(`(${Math.round((mappedByFacet("STATUS") / totalByFacet("STATUS")) * 100)}%), against ${Math.round((mappedByFacet("SUBJECT") / totalByFacet("SUBJECT")) * 100)}% of Subject tags. Section 5 addresses whether Status should therefore`);
p("be a shared enum rather than a mapping table.");
p();
p("**E. No CERC, APTEL, IRDAI or SEBI regulator exists in this database.**");
p(`The 11 regulators present are: ${CODES.join(", ")}. The enforcement-order`);
p("pattern could only be checked across the regulators that actually exist; it was confirmed");
p("between CCI and FIU and found absent everywhere else.");
p();
p("---");
p();

// --- Step 1: inventory -----------------------------------------------------
p("## 1. The real inventory");
p();
p("### 1.1 Live taxonomy version per regulator");
p();
p("Read from `UpdateEntry.taxonomyVersion` on real rows, joined through `SourceDocument` to");
p("`Regulator` — the same way DOS-ISRO's live version was confirmed, applied to all 11.");
p();
p("| Regulator | Domain | Live taxonomy version | Entries | `versionAdded` values on its tags |");
p("|---|---|---|---:|---|");
for (const r of f.regulators) {
  const v = f.liveVersions.filter((x) => x.regulator === r.code);
  const live = v.length ? v.map((x) => `\`${x.version}\``).join(", ") : "_no entries_";
  const n = v.reduce((a, b) => a + b.entries, 0);
  const added = [...new Set(f.tags.filter((t) => t.regulator === r.code).map((t) => t.version_added ?? "(null)"))]
    .sort()
    .map((x) => `\`${x}\``)
    .join(", ");
  p(`| **${r.code}** | ${esc(r.domain)} | ${live} | ${n ? n.toLocaleString() : "0"} | ${added} |`);
}
p();
p("The mismatch in the last two columns is Finding A. DST is the clearest case: every one of its");
p("tags is marked `v2.0`, and every one of its 692 entries is tagged `v1.0`.");
p();
p("### 1.2 Tag counts by facet");
p();
p("| Regulator | Subject | Instrument Type | Status | Total | Unused (0 entries) |");
p("|---|---:|---:|---:|---:|---:|");
for (const r of f.regulators) {
  const mine = f.tags.filter((t) => t.regulator === r.code);
  const c = (fa: string) => mine.filter((t) => t.facet === fa).length;
  p(`| **${r.code}** | ${c("SUBJECT")} | ${c("INSTRUMENT_TYPE")} | ${c("STATUS")} | ${mine.length} | ${mine.filter((t) => t.usage_count === 0).length} |`);
}
const tot = (fa: string) => f.tags.filter((t) => t.facet === fa).length;
p(`| **All** | **${tot("SUBJECT")}** | **${tot("INSTRUMENT_TYPE")}** | **${tot("STATUS")}** | **${f.tags.length}** | **${zero}** |`);
p();
p("Note: `Facet` in the schema also defines `APPLICABILITY` and `LICENSE_AUTHORISATION_TYPE`,");
p("but **no tag of either facet is seeded** — both are empty in the live database, including for");
p("DoT, which the schema comment describes as the LICENSE_AUTHORISATION_TYPE case. Out of scope");
p("for this task, but worth knowing before anyone relies on those facets.");
p();
p("### 1.3 Full tag inventory");
p();
p("Every tag, with the live taxonomy version of its regulator, its real usage count, and the");
p("canonical concept it maps to (blank where it maps to nothing, which is the common case).");
p();
for (const facet of FACET_ORDER) {
  p(`#### ${FACET_LABEL[facet]}`);
  p();
  p("| Regulator | Tag | Short code | Live version | Usage | Tag status | Mapped concept |");
  p("|---|---|---|---|---:|---|---|");
  for (const r of f.regulators) {
    const live = f.liveVersions.filter((x) => x.regulator === r.code).map((x) => x.version).join(", ") || "—";
    for (const t of f.tags.filter((x) => x.regulator === r.code && x.facet === facet)) {
      const flag = t.tag_status !== "ACTIVE" ? ` _(${t.tag_status})_` : "";
      p(`| ${r.code} | ${esc(t.tag)}${flag} | \`${esc(t.short_code)}\` | ${live} | ${t.usage_count} | ${t.tag_status} | ${t.concept ? esc(t.concept) : ""} |`);
    }
  }
  p();
}
p("---");
p();

// --- Step 2: comparison ----------------------------------------------------
p("## 2. Comparison: exact matches, near-duplicates, false cognates");
p();
p("### 2.1 Exact string matches across 2+ regulators");
p();
p("Computed from the real tag names, not assumed. **A name match is listed here as an observation,");
p("not as a conclusion** — the last column records whether reading the definitions confirmed it.");
p();
for (const facet of FACET_ORDER) {
  const rows = f.exactMatches[facet] ?? [];
  p(`#### ${FACET_LABEL[facet]} — ${rows.length} names shared by 2+ regulators`);
  p();
  p("| Tag name | Regulators | # | Verdict |");
  p("|---|---|---:|---|");
  for (const m of rows) {
    const verdict = m.mappedTo
      ? `mapped → **${esc(m.mappedTo)}**`
      : f.falseCognates.some((c) => c.tagName === m.name)
        ? "**FALSE COGNATE — not mapped**"
        : "not mapped";
    p(`| ${esc(m.name)} | ${m.regulators.join(", ")} | ${m.regulators.length} | ${verdict} |`);
  }
  p();
}
p("The premise that \"Press Release\", \"Annual Report\", \"FAQ\" and \"Not Applicable\" match across");
p("CCI / DOS-ISRO / FIU **holds, and extends further than expected**: Press Release is shared by six");
p("regulators and FAQ by five. It does *not* hold universally, though — `Notification`, `Order`,");
p("`Rules` and `Policy` all match by name across several regulators and are false cognates. See 2.3.");
p();

p("### 2.2 Near-duplicates — different wording, same real concept");
p();
p(`${f.nearDuplicates.length} of the ${f.concepts.length} canonical concepts group tags that do **not** all share a name.`);
p("Each was confirmed by reading the regulators' own definition text.");
p();
for (const facet of FACET_ORDER) {
  const rows = f.nearDuplicates.filter((n) => n.facet === facet);
  if (!rows.length) continue;
  p(`#### ${FACET_LABEL[facet]}`);
  p();
  for (const n of rows) {
    p(`**${esc(n.concept)}**`);
    p();
    p("| Regulator | Its actual tag name | Usage | Its own definition |");
    p("|---|---|---:|---|");
    for (const v of n.variants) p(`| ${v.regulator} | ${esc(v.tag)} | ${v.usage} | ${esc(v.definition)} |`);
    p();
    if (n.notes) {
      p(`> ${esc(n.notes)}`);
      p();
    }
  }
}
p("The enforcement-order pattern specifically called out for investigation is real, and it is");
p("**exactly two regulators wide**: CCI's `CCI Order` (1,221 entries) and FIU's");
p("`Adjudication / Penalty Order` (12 entries). FIU's own seeded text names the equivalence — its");
p("matching Subject tag reads \"structurally the closest equivalent to a CCI Order\". No third");
p("regulator has an adjudicatory-order instrument type. CERC, APTEL, IRDAI and SEBI are not in this");
p("database at all, so the suggestion that they might have equivalents could not be tested.");
p();

p("### 2.3 False cognates — same name, different real scope");
p();
p("**These are NOT mapped, deliberately.** Each regulator's own Tagging Guide definition text is");
p("reproduced verbatim so the difference is visible rather than asserted. Forcing a shared concept");
p("onto any of these would silently merge two different scopes and make cross-regulator search");
p("worse than no mapping at all.");
p();
for (const c of f.falseCognates) {
  p(`#### \`${esc(c.tagName)}\` — ${FACET_LABEL[c.facet]}`);
  p();
  p(esc(c.verdict));
  p();
  p("| Regulator (and disposition) | Its actual seeded definition |");
  p("|---|---|");
  for (const [k, v] of Object.entries(c.definitions)) p(`| ${esc(k)} | ${esc(v)} |`);
  p();
}
p("---");
p();

// --- Step 3/4: the mapping -------------------------------------------------
p("## 3. The schema addition");
p();
p("`CanonicalConcept` (migration `20260907075608_add_canonical_concept`) plus a **nullable**");
p("`TaxonomyTag.canonicalConceptId` foreign key with `ON DELETE SET NULL`.");
p();
p("```prisma");
p("model CanonicalConcept {");
p("  id         String        @id @default(cuid())");
p("  facet      Facet         // SUBJECT | INSTRUMENT_TYPE | STATUS");
p("  name       String");
p("  definition String");
p("  notes      String?       // why borderline regulators were in- or excluded");
p("  createdAt  DateTime      @default(now())");
p("  tags       TaxonomyTag[]");
p("");
p("  @@unique([facet, name])");
p("  @@index([facet])");
p("}");
p("```");
p();
p("The migration is purely additive: one new table, one nullable column, two indexes and one");
p("foreign key. No existing row was modified, renamed, merged or deleted, and no regulator's own");
p("taxonomy changed in any way.");
p();
p("The `facet` field reuses the existing `Facet` enum rather than a free-text string, so a concept");
p("cannot be created against a facet that does not exist, and a Subject concept cannot accidentally");
p("be linked to an Instrument Type tag.");
p();

p("## 4. Canonical concepts created");
p();
const mappedTotal = f.tags.filter((t) => t.concept).length;
p(`**${f.concepts.length} concepts, linking ${mappedTotal} of ${f.tags.length} tags (${Math.round((mappedTotal / f.tags.length) * 100)}%).**`);
p(`The remaining ${f.tags.length - mappedTotal} tags map to nothing. That is the correct outcome, not a backlog:`);
p("most Subject tags are irreducibly regulator-specific (`Abuse of Dominant Position`,");
p("`SACFA Clearances`, `Sports Broadcasting Signal Sharing (Prasar Bharati)`), and the tags in");
p("section 2.3 are unmapped on purpose.");
p();
p("| Facet | Concepts | Tags mapped | Tags total | % |");
p("|---|---:|---:|---:|---:|");
for (const facet of FACET_ORDER) {
  const m = mappedByFacet(facet), t = totalByFacet(facet);
  p(`| ${FACET_LABEL[facet]} | ${f.concepts.filter((c) => c.facet === facet).length} | ${m} | ${t} | ${Math.round((m / t) * 100)}% |`);
}
p(`| **Total** | **${f.concepts.length}** | **${mappedTotal}** | **${f.tags.length}** | **${Math.round((mappedTotal / f.tags.length) * 100)}%** |`);
p();
for (const facet of FACET_ORDER) {
  const rows = f.concepts.filter((c) => c.facet === facet);
  p(`### ${FACET_LABEL[facet]} — ${rows.length} concepts`);
  p();
  for (const c of rows) {
    p(`#### ${esc(c.name)}`);
    p();
    p(`_${esc(c.definition)}_`);
    p();
    p("| Regulator | Its tag | Usage |");
    p("|---|---|---:|");
    for (const t of c.tags) {
      const u = f.tags.find((x) => x.regulator === t.regulator && x.facet === facet && x.tag === t.tag)?.usage_count ?? 0;
      p(`| ${t.regulator} | ${esc(t.tag)} | ${u} |`);
    }
    p();
    if (c.notes) {
      p(`> **Why these and not others.** ${esc(c.notes)}`);
      p();
    }
  }
}
p("---");
p();

// --- Step 3 alternative: Status as an enum ---------------------------------
p("## 5. Should Status be a shared enum instead of a mapping table?");
p();
p("The task asked for this to be evaluated for Status specifically, on the real data, rather than");
p("applying the mapping-table pattern uniformly to all three facets. The convergence is real:");
p();
const stTags = f.tags.filter((t) => t.facet === "STATUS");
p(`- ${stTags.length} Status tags exist across 11 regulators — an average of ${(stTags.length / 11).toFixed(1)} each, against`);
p(`  ${(totalByFacet("SUBJECT") / 11).toFixed(1)} Subject tags each.`);
p("- Three values (`In Force`, `Amended`, `Draft / Under Consultation`) are present at **all 11**");
p("  regulators, by exact name, with near-verbatim identical definitions.");
p(`- ${mappedByFacet("STATUS")} of ${stTags.length} Status tags (${Math.round((mappedByFacet("STATUS") / stTags.length) * 100)}%) map to a shared concept.`);
p();
p("**Recommendation: keep the mapping table for Status too. Do not convert it to an enum.**");
p();
p("Three things in the real data defeat the enum:");
p();
p("1. **DST already broke the enum once, and the schema records it.** DST's Funding Calls use");
p("   `Open / Accepting Applications`, `Closed / Applications Closed` and `Results Announced` —");
p("   645 entries between them, more than DST's `In Force` count. A global `DocumentStatus` enum is");
p("   exactly what the schema *used to* have; it was removed in migration");
p("   `20260817080000_drop_legacy_document_status_enum` precisely because DST needed these values.");
p("   Reintroducing an enum would re-create the problem that migration solved.");
p();
p("2. **The supersession concept is genuinely two different granularities.** Seven regulators use a");
p("   single combined `Superseded / Repealed`; four use a separate `Superseded`, and three of those");
p("   also carry a distinct `Repealed`. An enum forces a choice: either drop the distinction that");
p("   CCI, DOS-ISRO, DST and FIU deliberately make, or add both values and misrepresent the seven");
p("   regulators that never draw it. The mapping table represents this honestly with three concepts");
p("   (`Superseded`, `Repealed`, `Superseded / Repealed (combined)`), the third documented as the");
p("   union of the other two.");
p();
p("3. **`statusAppliesToSubjectIds` has no enum equivalent, and it is already load-bearing.** A");
p("   Status tag can be scoped to specific Subjects of the same regulator, and both the");
p("   classification prompt and `lib/ingest.ts` read the field. Checked against the live database,");
p("   **all seven of DST's Status tags are scoped this way** — not just its three funding-call");
p("   values. DST's `In Force` is valid for only 6 of its 9 Subjects and is a category error on the");
p("   three Funding Calls Subjects, which use `Open` / `Closed` / `Results Announced` instead. So");
p("   even the three values that all 11 regulators genuinely share do **not** mean \"applies to");
p("   everything\" at DST. An enum value is a bare symbol with nowhere to hang that scoping; the");
p("   mapping table leaves it on the tag, where it already works.");
p();
p("The mapping table already delivers the benefit an enum was wanted for: a cross-regulator");
p("\"everything currently in force\" query is `WHERE canonicalConcept.name = 'In Force'`, and it");
p("works across all 11 regulators today. It does so without discarding DST's lifecycle, without");
p("flattening the supersession distinction, and without another destructive migration.");
p();
p("---");
p();

// --- Step 5: verification --------------------------------------------------
p("## 6. Verification");
p();
p("There is no test suite in this repo (`package.json` defines no `test` script and there is no");
p("test directory), so verification was done by snapshot comparison against the live database.");
p();
p("`scripts/.audit/snapshot.ts` executes the real query layer in `lib/queries.ts` — the same");
p("functions the public wiki and the admin review UI call — and SHA-256 hashes each result. It was");
p("run before the migration and again after the migration and the mapping were applied. It covers:");
p();
p("- `getRegulators`, `getDomainOverview`, `getPublicCountsByRegulator`, `getFlaggedCountsByRegulator`");
p("- `getTagsByFacet` for Subject and Instrument Type");
p("- `getRegulatorDetail`, `getTagOptions`, `listPublicEntries` and `listFlaggedEntries` for each of the 11 regulators");
p("- `listPublicEntries` filtered by **every single tag**, for all three facets — Subject and");
p("  Instrument Type through the real query functions, Status through `statusId` directly");
p("- `getTag` for every Subject and Instrument Type tag");
p();
p("615 query results in total. The result is recorded in section 6.1.");
p();
p("**What this does and does not prove.** `lib/queries.ts` uses explicit narrow `select` shapes");
p("everywhere (`ENTRY_LIST_SELECT` and friends), so the new `canonicalConceptId` column never");
p("enters any of these payloads — which is itself part of why the change is safe. What the");
p("comparison therefore verifies is the thing that actually matters for this step: the *entries");
p("returned*, their *ordering*, their *counts* and the *tag option lists* are identical for every");
p("tag at every regulator. It would have caught a filter returning different documents, a tag");
p("disappearing from a dropdown, or a count shifting. It is not a claim that the column is absent");
p("from the schema — it is there, and unused by the existing read path, by design.");
p();
p("Reproduce with:");
p();
p("```bash");
p("npx tsx scripts/.audit/snapshot.ts before   # (pre-migration)");
p("npx tsx scripts/.audit/snapshot.ts after");
p("npx tsx scripts/.audit/compare-snapshots.ts");
p("```");
p();
p("### 6.1 Result");
p();
// Substituted from the real comparison output, so the report can only ever
// state the result the comparison actually produced.
try {
  p(readFileSync("scripts/.audit/verification-result.md", "utf8").trimEnd());
} catch {
  p("_Not yet run — execute `npx tsx scripts/.audit/compare-snapshots.ts`, then regenerate this report._");
}
p();
p("---");
p();

// --- Reproduction ----------------------------------------------------------
p("## 7. How to regenerate this report");
p();
p("All mapping decisions live in one file, `scripts/canonical-concepts.data.ts`. The database rows,");
p("this report and the Excel workbook are all generated from it, so they cannot disagree:");
p();
p("```bash");
p("npx tsx scripts/populate-canonical-concepts.ts --dry-run  # validate every tag name resolves");
p("npx tsx scripts/populate-canonical-concepts.ts            # write CanonicalConcept + links");
p("npx tsx scripts/build-taxonomy-findings.ts                # export live data -> .audit/findings.json");
p("npx tsx scripts/build-taxonomy-report.ts                  # this file");
p("python scripts/build-taxonomy-workbook.py                 # taxonomy-canonical-concepts.xlsx");
p("```");
p();
p("`build-taxonomy-findings.ts` refuses to export if the database and the mapping data file");
p("disagree, and `populate-canonical-concepts.ts` refuses to write if any tag name in the data file");
p("does not resolve to a real seeded tag.");
p();
p("**If a mapping decision changes, change it in `canonical-concepts.data.ts` and re-run all five");
p("steps.** Do not edit this file or the workbook by hand — both are generated artefacts.");
p();

writeFileSync("taxonomy-canonical-concepts.md", L.join("\n"));
console.log(`taxonomy-canonical-concepts.md: ${L.length} lines`);
