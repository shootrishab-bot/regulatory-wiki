/** Shared shape every DST source module (dst-core, dst-calls, nsdi, aistic)
 * produces, fanned out and merged by watch.ts -- mirrors how the Saral
 * Sanchar module's two feeds share one ScrapedDocument shape. */
export const REGULATOR_CODE = "DST";

export interface DstScrapedDocument {
  sourceId: string;
  regulator: typeof REGULATOR_CODE;
  sourceCluster: string;
  listingUrl: string;
  title: string;
  /** Direct PDF/doc attachment, when one exists. */
  fileUrl: string | null;
  /** A node/detail page to extract via HTML when there's no (or in addition
   * to a) file attachment -- e.g. a Call for Proposals node page. */
  htmlUrl: string | null;
  publishedDate: string | null;
  /** Real site-native status signal (e.g. "Open"/"Closed" derived from a
   * real Start/End Date column), when this source has one -- ground truth
   * that overrides the classifier's own guess, same mechanism as MTCTE's
   * Active/Expired status_hint. Null for sources with no such signal. */
  statusHint: string | null;
  scrapedAt: string;
}
