/**
 * Trusts the OS certificate store IN ADDITION TO Node's bundled Mozilla
 * roots, for the outbound document fetches getFullText() makes.
 *
 * REAL BUG FOUND AND FIXED (2026-09-09): every one of ESIC's 300 scraped
 * documents was failing text extraction with `text_extraction_failed`, so
 * each one would have been classified from its title alone and flagged for
 * review. The cause was not the PDFs and not esic.gov.in being down --
 * `curl` fetched them fine. esic.gov.in serves an INCOMPLETE certificate
 * chain (it omits the intermediate), and Node's OpenSSL verifier rejects
 * that with UNABLE_TO_VERIFY_LEAF_SIGNATURE, while curl on Windows succeeds
 * because schannel completes the chain from the OS store. Verified
 * deterministically: 6 of 6 sampled ESIC URLs failed without this, 6 of 6
 * succeeded with it (4,034-12,000 chars of real extracted text).
 *
 * This is strictly ADDITIVE and is NOT a verification bypass -- the
 * alternative fix, NODE_TLS_REJECT_UNAUTHORIZED=0, would disable
 * verification for every outbound call in the process including Neon
 * Postgres and the DeepSeek API, which is not acceptable. Here the bundled
 * roots are kept and the OS roots (the same set the user's own browser and
 * curl already trust) are merged in, so certificates are still fully
 * verified -- just against a superset of trust anchors.
 *
 * Deliberately best-effort: tls.getCACertificates/setDefaultCACertificates
 * are Node >=22.15/24 APIs, so on an older runtime this is a silent no-op
 * and behavior is exactly what it was before. Callers must not depend on it
 * having succeeded -- getFullText() already degrades to
 * `text_extraction_failed` + a review flag, which stays the correct outcome
 * for a host this cannot rescue.
 */
import tls from "node:tls";

let applied = false;

export function trustSystemCAs(): void {
  if (applied) return;
  applied = true;
  try {
    const t = tls as unknown as {
      getCACertificates?: (type: "default" | "system") => string[];
      setDefaultCACertificates?: (certs: string[]) => void;
    };
    if (!t.getCACertificates || !t.setDefaultCACertificates) return;
    const bundled = t.getCACertificates("default");
    const system = t.getCACertificates("system");
    if (!system?.length) return;
    t.setDefaultCACertificates(Array.from(new Set([...bundled, ...system])));
  } catch {
    // No-op on any runtime that doesn't support this. See the note above:
    // failing here must never break ingestion.
  }
}
