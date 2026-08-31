/**
 * Scope exclusion -- real, evidence-backed keyword heuristics matching the
 * DST_Regulatory_Taxonomy_v2_0.xlsx Tagging Guide's own explicit
 * exclusions: one-off recruitment/vacancy advertisements, newsletters, S&T
 * articles, and monthly achievement reports are OUT OF SCOPE entirely for
 * this regulator (v2.0's own rescoping decision) -- these should never
 * reach the classifier at all, not be force-fit into an adjacent Subject
 * like "Governance and Administration" just because they came from a DST
 * page (the Tagging Guide's own explicit warning).
 *
 * Applied at the SCRAPE stage, not the classification stage: the shared
 * classification pipeline (lib/ingest.ts) has no "reject, don't tag"
 * concept for any regulator, and adding one project-wide would be a much
 * bigger change than this one regulator's real, narrow need. Real evidence
 * this is needed: aistic.gov.in's real "What's New" funding-calls feed
 * (2026-08-17) contains at least one genuine recruitment ad mixed in --
 * "Applications for appointment of Director, Indo-German S&T Centre
 * (IGSTC)" -- despite the feed otherwise being real Calls for Proposals.
 *
 * Deliberately narrow and evidence-driven, not a broad content filter: the
 * Tagging Guide's own distinction is standing rule vs. one-off, not
 * "anything HR-adjacent" (a draft recruitment RULES document stays in
 * scope under Service Conditions & Recruitment Rules -- see
 * sources/dst-core.ts's real "Estate Officer" example, which this filter
 * must NOT catch).
 */

const RECRUITMENT_AD_RE =
  /\b(applications? (invited |are invited )?for (the )?(appointment|post|position) of|vacanc(y|ies)|walk-?in interview|advertisement for the post)\b/i;
const NEWSLETTER_RE = /\b(e-)?newsletter\b|\bstrides\b/i;
const MONTHLY_REPORT_RE = /\bmonthly (achievement|progress) report\b/i;

export interface ScopeCheck {
  inScope: boolean;
  reason: string | null;
}

export function checkScope(title: string): ScopeCheck {
  if (RECRUITMENT_AD_RE.test(title)) {
    return { inScope: false, reason: "recruitment/vacancy advertisement" };
  }
  if (NEWSLETTER_RE.test(title)) {
    return { inScope: false, reason: "newsletter" };
  }
  if (MONTHLY_REPORT_RE.test(title)) {
    return { inScope: false, reason: "monthly achievement/progress report" };
  }
  return { inScope: true, reason: null };
}
