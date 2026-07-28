/**
 * Pure-logic test for resolveStatusValue() — no Postgres, no DeepSeek, no
 * MTCTE ingestion run. Exercises the real decision from the status_hint
 * pressure-test conversation (2026-07-28) using the actual titles/status
 * values that decision was based on, plus the DoT-equivalent no-hint case
 * to confirm regulators without this signal are unaffected.
 */
import { resolveStatusValue } from "../lib/ingest";
import { DocumentStatus } from "@/app/generated/prisma/enums";

let failures = 0;

function check(label: string, actual: DocumentStatus, expected: DocumentStatus) {
  const pass = actual === expected;
  console.log(`[${pass ? "PASS" : "FAIL"}] ${label} -> ${actual} (expected ${expected})`);
  if (!pass) failures++;
}

// --- Real MTCTE Active documents (status_hint = "Active") ---
check(
  '"MTCTE User Instructions V 3.0" (Active, 2024-01-23), model said "In Force"',
  resolveStatusValue("In Force", "Active"),
  DocumentStatus.IN_FORCE
);
check(
  '"Notification of Telecommunication Equipment under Phase-VI of MTCTE" (Active, 2025-02-27), model said "Amended" (hint must still win)',
  resolveStatusValue("Amended", "Active"),
  DocumentStatus.IN_FORCE
);

// --- Real MTCTE Expired documents (status_hint = "Expired") ---
// Both confirmed via real full-text spot-check to be version-numbered
// manuals genuinely superseded by a later numbered version elsewhere in
// the same archive.
check(
  '"MTCTE Procedure ver 2.0" (Expired, 2022-08-24), model said "In Force" (hint must override)',
  resolveStatusValue("In Force", "Expired"),
  DocumentStatus.SUPERSEDED_REPEALED
);
check(
  '"MTCTE Applicant User Instructions" (Expired, 2022-08-24), model said "In Force" (hint must override)',
  resolveStatusValue("In Force", "Expired"),
  DocumentStatus.SUPERSEDED_REPEALED
);

// --- DoT-equivalent: no status_hint at all (null) ---
// Confirms every regulator without this signal falls through to the
// classifier's own label exactly as before this change.
check(
  "DoT-equivalent doc, no status_hint, model said \"In Force\"",
  resolveStatusValue("In Force", null),
  DocumentStatus.IN_FORCE
);
check(
  "DoT-equivalent doc, no status_hint, model said \"Superseded/Repealed\"",
  resolveStatusValue("Superseded/Repealed", null),
  DocumentStatus.SUPERSEDED_REPEALED
);
check(
  "DoT-equivalent doc, no status_hint, model returned an invalid/unrecognized label (default preserved)",
  resolveStatusValue("not-a-real-label", null),
  DocumentStatus.IN_FORCE
);

console.log();
console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
