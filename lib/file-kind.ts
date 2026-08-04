/**
 * Classifies what a SourceDocument.fileUrl actually points at.
 *
 * The schema stores only a URL; it does not record whether that URL is a real
 * downloadable file or a reference page. The scrapers DO know the difference
 * (mib_adapter.py sets needs_download), but that flag is not persisted, so the
 * distinction is re-derived here from the URL itself.
 *
 * Real distribution across the corpus (measured 2026-08-03):
 *   direct file         1,256   DoT 587, MIB 520, MTCTE 149
 *   external reference    486   of which 471 are pib.gov.in press releases
 *   flipbook viewer        23   MIB e-books, an internal /en/flipbook/N page
 *   no file url             2
 *
 * Worth noting against the earlier assumption that external references were a
 * "small number of India Code / NFDC links": those specific ones really are
 * tiny (3 documents), but the dominant external case is PIB press releases at
 * 471. Roughly a quarter of the corpus cannot be previewed as a file.
 */

const DOCUMENT_EXTENSION = /\.(pdf|xlsx|xls|csv|docx?|pptx?)(\?.*)?$/i;
const FLIPBOOK = /\/flipbook\/\d+/i;

export type FileKind = "direct-file" | "flipbook" | "external-reference" | "none";

export function classifyFileUrl(fileUrl: string | null | undefined): FileKind {
  if (!fileUrl) return "none";
  if (DOCUMENT_EXTENSION.test(fileUrl)) return "direct-file";
  if (FLIPBOOK.test(fileUrl)) return "flipbook";
  return "external-reference";
}

export function isDirectFile(fileUrl: string | null | undefined): boolean {
  return classifyFileUrl(fileUrl) === "direct-file";
}

/** True only for PDFs, the one type a browser reliably renders in a frame. */
export function isPdf(fileUrl: string | null | undefined): boolean {
  return !!fileUrl && /\.pdf(\?.*)?$/i.test(fileUrl);
}

export function fileExtension(fileUrl: string | null | undefined): string | null {
  if (!fileUrl) return null;
  const m = fileUrl.match(DOCUMENT_EXTENSION);
  return m ? m[1].toLowerCase() : null;
}
