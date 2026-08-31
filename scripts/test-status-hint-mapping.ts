/**
 * Pure-logic test for resolveStatusTag() — no Postgres, no DeepSeek, no
 * MTCTE ingestion run. Exercises the real decisions from the status_hint
 * pressure-test conversation (2026-07-28), plus the newer scope_mismatch
 * case added for DST's hybrid Status vocabulary (2026-08-17), using fixture
 * tags shaped like a real regulator's seeded STATUS facet.
 */
import { resolveStatusTag, type StatusResolution, type StatusTagLike } from "../lib/ingest";

let failures = 0;

function check(label: string, actual: StatusResolution, expected: { tagName: string | null; reason: StatusResolution["reason"] }) {
  const pass = (actual.tag?.name ?? null) === expected.tagName && actual.reason === expected.reason;
  console.log(
    `[${pass ? "PASS" : "FAIL"}] ${label} -> tag=${actual.tag?.name ?? "null"} reason=${actual.reason} ` +
      `(expected tag=${expected.tagName ?? "null"} reason=${expected.reason})`
  );
  if (!pass) failures++;
}

// --- Fixture: a standard 4-value, unscoped Status facet (every regulator
// except DST looks like this -- see prisma/seed-shared.ts). ---
const STANDARD: StatusTagLike[] = [
  { id: "s-inforce", name: "In Force", statusAppliesToSubjectIds: [] },
  { id: "s-draft", name: "Draft / Under Consultation", statusAppliesToSubjectIds: [] },
  { id: "s-amended", name: "Amended", statusAppliesToSubjectIds: [] },
  { id: "s-superseded", name: "Superseded / Repealed", statusAppliesToSubjectIds: [] },
];

// --- Real MTCTE Active documents (status_hint = "Active") ---
check(
  '"MTCTE User Instructions V 3.0" (Active, 2024-01-23), model said "In Force"',
  resolveStatusTag(STANDARD, undefined, "In Force", "Active"),
  { tagName: "In Force", reason: "ok" }
);
check(
  '"Notification of Telecommunication Equipment under Phase-VI of MTCTE" (Active, 2025-02-27), model said "Amended" (hint must still win)',
  resolveStatusTag(STANDARD, undefined, "Amended", "Active"),
  { tagName: "In Force", reason: "ok" }
);

// --- Real MTCTE Expired documents (status_hint = "Expired") ---
check(
  '"MTCTE Procedure ver 2.0" (Expired, 2022-08-24), model said "In Force" (hint must override)',
  resolveStatusTag(STANDARD, undefined, "In Force", "Expired"),
  { tagName: "Superseded / Repealed", reason: "ok" }
);
check(
  '"MTCTE Applicant User Instructions" (Expired, 2022-08-24), model said "In Force" (hint must override)',
  resolveStatusTag(STANDARD, undefined, "In Force", "Expired"),
  { tagName: "Superseded / Repealed", reason: "ok" }
);

// --- DoT-equivalent: no status_hint at all (null) ---
check(
  "DoT-equivalent doc, no status_hint, model said \"In Force\"",
  resolveStatusTag(STANDARD, undefined, "In Force", null),
  { tagName: "In Force", reason: "ok" }
);
check(
  "DoT-equivalent doc, no status_hint, model said \"Superseded / Repealed\"",
  resolveStatusTag(STANDARD, undefined, "Superseded / Repealed", null),
  { tagName: "Superseded / Repealed", reason: "ok" }
);
check(
  "DoT-equivalent doc, no status_hint, model returned an invalid/unrecognized label -> no_match, no silent default",
  resolveStatusTag(STANDARD, undefined, "not-a-real-label", null),
  { tagName: null, reason: "no_match" }
);

// --- DST's hybrid vocabulary: scope_mismatch case ---
const FUNDING_SUBJECT = { id: "subj-funding-domestic" };
const DST_STATUS: StatusTagLike[] = [
  { id: "s-inforce", name: "In Force", statusAppliesToSubjectIds: ["subj-gazette", "subj-policy"] },
  { id: "s-open", name: "Open / Accepting Applications", statusAppliesToSubjectIds: ["subj-funding-domestic", "subj-funding-intl"] },
  { id: "s-closed", name: "Closed / Applications Closed", statusAppliesToSubjectIds: ["subj-funding-domestic", "subj-funding-intl"] },
];
check(
  '"Gazette Notification of ANRF" -> Subject is a formal-instrument Subject, model correctly said "In Force"',
  resolveStatusTag(DST_STATUS, { id: "subj-gazette" }, "In Force", null),
  { tagName: "In Force", reason: "ok" }
);
check(
  'Funding call doc, model correctly said "Open / Accepting Applications" for a funding Subject',
  resolveStatusTag(DST_STATUS, FUNDING_SUBJECT, "Open / Accepting Applications", null),
  { tagName: "Open / Accepting Applications", reason: "ok" }
);
check(
  'Category error: model said "In Force" for a funding-call Subject -> real tag, but scope_mismatch, must be flagged',
  resolveStatusTag(DST_STATUS, FUNDING_SUBJECT, "In Force", null),
  { tagName: "In Force", reason: "scope_mismatch" }
);
check(
  'Category error: model said "Open / Accepting Applications" for a gazette Subject -> scope_mismatch',
  resolveStatusTag(DST_STATUS, { id: "subj-gazette" }, "Open / Accepting Applications", null),
  { tagName: "Open / Accepting Applications", reason: "scope_mismatch" }
);
console.log();
console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
