/**
 * Compares the before/after query snapshots. Step 5 of the taxonomy audit:
 * the CanonicalConcept layer is additive, so every single one of these query
 * results must be byte-identical across the migration.
 */
import { readFileSync, writeFileSync } from "fs";

const before: Record<string, string> = JSON.parse(readFileSync("scripts/.audit/snapshot-before.json", "utf8"));
const after: Record<string, string> = JSON.parse(readFileSync("scripts/.audit/snapshot-after.json", "utf8"));

const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
const changed: string[] = [];
const onlyBefore: string[] = [];
const onlyAfter: string[] = [];

for (const k of keys) {
  if (!(k in after)) onlyBefore.push(k);
  else if (!(k in before)) onlyAfter.push(k);
  else if (before[k] !== after[k]) changed.push(k);
}

console.log(`before: ${Object.keys(before).length} results`);
console.log(`after:  ${Object.keys(after).length} results`);
console.log(`compared: ${keys.length} keys`);
console.log(`\nchanged: ${changed.length}`);
for (const k of changed.slice(0, 50)) console.log("  ! " + k);
if (onlyBefore.length) { console.log(`\nmissing after: ${onlyBefore.length}`); for (const k of onlyBefore.slice(0, 20)) console.log("  - " + k); }
if (onlyAfter.length) { console.log(`\nnew after: ${onlyAfter.length}`); for (const k of onlyAfter.slice(0, 20)) console.log("  + " + k); }

const ok = changed.length === 0 && onlyBefore.length === 0 && onlyAfter.length === 0;
console.log(ok ? "\nPASS — every query returns identical results" : "\nFAIL — see above");

// Emit the block that build-taxonomy-report.ts substitutes into the report,
// so the report states the real result rather than a claimed one.
const lines = ok
  ? [
      `**PASS.** All ${keys.length} query results are byte-identical before and after the migration.`,
      "",
      "Nothing about how any single regulator's own tags behave changed. Subject, Instrument Type",
      "and Status filtering return exactly the same entries, in the same order, for every tag at",
      "every regulator. The mapping layer is purely additive, as intended.",
    ]
  : [
      `**FAIL.** ${changed.length} of ${keys.length} query results differ before and after the migration` +
        (onlyBefore.length || onlyAfter.length ? `, with ${onlyBefore.length} missing and ${onlyAfter.length} new keys` : "") +
        ".",
      "",
      "Differing keys:",
      "",
      ...changed.slice(0, 50).map((k) => `- \`${k}\``),
    ];
writeFileSync("scripts/.audit/verification-result.md", lines.join("\n"));
process.exit(ok ? 0 : 1);
