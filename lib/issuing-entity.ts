/**
 * Real, confirmed gap (2026-08-19 lawyer's-perspective audit): the
 * DOS-ISRO regulator bundles 4 legally distinct real entities -- the
 * Department of Space (a government department), ISRO (the implementing
 * agency), IN-SPACe (the actual independent regulator for private space
 * activity), and NSIL (a commercial PSU) -- under one Regulator badge.
 * Whether a document is IN-SPACe exercising regulatory authority or NSIL
 * signing a commercial contract has real legal significance, and nothing
 * in the UI surfaced that distinction -- a user had to open the source
 * link and read the domain themselves.
 *
 * category_hint (which DOES carry this distinction, e.g. "ISRO_TENDERS",
 * "INSPACE_AUTHORIZATIONS") is used only transiently in the classification
 * prompt and is never persisted to Postgres (see lib/ingest.ts) -- adding
 * a persisted column would need a migration and a re-ingest. sourceUrl's
 * own domain is ALREADY persisted, already selected in every query that
 * needs this, and is a reliable, always-accurate signal (it can't go
 * stale the way a separately-stored label could) -- so this derives the
 * issuing entity from sourceUrl at render time instead.
 *
 * Deliberately keyed by hostname, not by Regulator.code, so this scales
 * to any future regulator that turns out to bundle multiple real issuing
 * bodies the same way -- not hardcoded to DOS-ISRO specifically.
 */

const ISSUING_ENTITY_BY_HOST: Record<string, string> = {
  "www.isro.gov.in": "ISRO",
  "isro.gov.in": "ISRO",
  "www.inspace.gov.in": "IN-SPACe",
  "inspace.gov.in": "IN-SPACe",
  "www.nsilindia.co.in": "NSIL",
  "nsilindia.co.in": "NSIL",
  "www.dos.gov.in": "DOS",
  "dos.gov.in": "DOS",
};

/**
 * Returns the real issuing entity's short name for a document's sourceUrl,
 * or null if the domain isn't one of the known real sources (e.g. an
 * external link like herox.com) -- null is a meaningful, real answer
 * here ("not one of the 4 known issuing bodies"), not an error, so
 * callers should render nothing rather than a placeholder for it.
 */
export function getIssuingEntity(sourceUrl: string | null | undefined): string | null {
  if (!sourceUrl) return null;
  try {
    const host = new URL(sourceUrl).hostname.toLowerCase();
    return ISSUING_ENTITY_BY_HOST[host] ?? null;
  } catch {
    return null;
  }
}
