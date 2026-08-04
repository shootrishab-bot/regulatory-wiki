/**
 * Backfills publishedDate for documents whose SOURCE LISTING never provided
 * one, by reading the date printed on the document itself.
 *
 * REAL SCOPE (measured 2026-08-03): 167 documents have no publishedDate --
 * all 151 MTCTE documents (its listing has no date column at all), 15 MIB,
 * and 1 DoT. 164 of those have a direct file that can be inspected.
 *
 * TWO-STAGE READ
 *   1. PDF text layer via pdf-parse.
 *   2. If the text layer is empty or near-empty the document is a SCAN, so
 *      page 1 is rasterised (pdf-parse getScreenshot) and run through OCR
 *      (tesseract.js, pure WASM -- no system tesseract/poppler needed, and
 *      none is installed here). Confirmed working end to end on a real
 *      scanned MTCTE notification: 28 chars of text layer, 1,837 chars after
 *      OCR, yielding "Dated: 03.07.2023".
 *
 * Date selection is deliberately conservative -- see lib/document-date.ts for
 * why an anchored "Date:"/"Dated:" match is required rather than any date in
 * the text (real documents also contain file reference numbers and validity
 * deadlines that a bare regex happily mistakes for the issue date).
 *
 * OCR is slow (seconds per page), so it runs only where the text layer
 * genuinely failed, concurrency is low, and a single reusable worker is
 * shared across documents rather than started per file.
 *
 * Dry-run by default; pass --apply. Only publishedDate is ever written.
 *
 * Usage:
 *   npx tsx scripts/backfill-missing-dates.ts --limit 20
 *   npx tsx scripts/backfill-missing-dates.ts --apply
 *   npx tsx scripts/backfill-missing-dates.ts --apply --no-ocr
 */

import "dotenv/config";
import { PDFParse } from "pdf-parse";
import type { Worker } from "tesseract.js";
import { prisma } from "../lib/prisma";
import { extractIssueDate } from "../lib/document-date";
import { isDirectFile } from "../lib/file-kind";

const APPLY = process.argv.includes("--apply");
const NO_OCR = process.argv.includes("--no-ocr");

function argNum(flag: string, fallback: number): number {
  const i = process.argv.indexOf(flag);
  const v = i !== -1 ? Number(process.argv[i + 1]) : NaN;
  return Number.isFinite(v) && v > 0 ? v : fallback;
}
const LIMIT = argNum("--limit", 0);
const CONCURRENCY = argNum("--concurrency", 4);

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

/** Below this, treat the PDF as a scan with no usable text layer. */
const TEXT_LAYER_MIN_CHARS = 120;
/** OCR the first N pages; letterheads are always on page 1, but a cover
 *  sheet occasionally pushes the date to page 2. */
const OCR_PAGES = 2;

let ocrWorker: Worker | null = null;
async function getOcrWorker(): Promise<Worker> {
  if (!ocrWorker) {
    const { createWorker } = await import("tesseract.js");
    ocrWorker = await createWorker("eng");
  }
  return ocrWorker;
}

async function ocrPdf(buf: Buffer): Promise<string> {
  const parser = new PDFParse({ data: buf });
  let out = "";
  try {
    const shot = await parser.getScreenshot({ first: 1, last: OCR_PAGES, scale: 2 });
    const worker = await getOcrWorker();
    for (const page of shot.pages ?? []) {
      const dataUrl = (page as unknown as { dataUrl?: string }).dataUrl;
      if (!dataUrl) continue;
      const img = Buffer.from(dataUrl.replace(/^data:image\/\w+;base64,/, ""), "base64");
      const { data } = await worker.recognize(img);
      out += (data.text || "") + "\n";
      // Stop as soon as a page yields a usable date.
      if (extractIssueDate(out)) break;
    }
  } finally {
    await parser.destroy().catch(() => {});
  }
  return out;
}

async function main() {
  const docs = await prisma.$queryRawUnsafe<
    { id: string; code: string; title: string; fileUrl: string }[]
  >(`
    SELECT sd.id, r.code, sd.title, sd."fileUrl"
    FROM "SourceDocument" sd
    JOIN "Regulator" r ON r.id = sd."regulatorId"
    WHERE sd."publishedDate" IS NULL AND sd."fileUrl" IS NOT NULL
    ORDER BY r.code, sd.title
    ${LIMIT > 0 ? `LIMIT ${LIMIT}` : ""}
  `);

  const targets = docs.filter((d) => isDirectFile(d.fileUrl));
  console.log(
    `undated documents with a file: ${docs.length} (${targets.length} direct files)  ` +
      `mode=${APPLY ? "APPLY" : "DRY RUN"}${NO_OCR ? "  ocr=OFF" : ""}\n`
  );

  const stats = {
    fromTextLayer: 0,
    fromOcr: 0,
    scannedNoDate: 0,
    textNoDate: 0,
    fetchFailed: 0,
    ocrFailed: 0,
  };
  const found: string[] = [];

  let cursor = 0;
  async function worker() {
    while (cursor < targets.length) {
      const d = targets[cursor++];
      let buf: Buffer;
      try {
        const res = await fetch(d.fileUrl, { headers: { "User-Agent": UA } });
        if (!res.ok) {
          stats.fetchFailed++;
          continue;
        }
        buf = Buffer.from(await res.arrayBuffer());
      } catch {
        stats.fetchFailed++;
        continue;
      }

      let text = "";
      try {
        const parser = new PDFParse({ data: buf });
        text = (await parser.getText()).text || "";
        await parser.destroy().catch(() => {});
      } catch {
        text = "";
      }

      let hit = extractIssueDate(text);
      let via: "text" | "ocr" = "text";

      const scanned = text.trim().length < TEXT_LAYER_MIN_CHARS;
      if (!hit && scanned && !NO_OCR) {
        try {
          const ocrText = await ocrPdf(buf);
          hit = extractIssueDate(ocrText);
          via = "ocr";
        } catch {
          stats.ocrFailed++;
        }
      }

      if (!hit) {
        if (scanned) stats.scannedNoDate++;
        else stats.textNoDate++;
        continue;
      }

      if (via === "ocr") stats.fromOcr++;
      else stats.fromTextLayer++;

      if (found.length < 25) {
        found.push(
          `  ${d.code}  ${hit.date.toISOString().slice(0, 10)}  [${via}/${hit.form}]  ` +
            `"${hit.evidence.slice(0, 26)}"  ${d.title.slice(0, 44)}`
        );
      }

      if (APPLY) {
        await prisma.sourceDocument.update({
          where: { id: d.id },
          data: { publishedDate: hit.date },
        });
      }
    }
  }

  // OCR is CPU-bound and shares one worker, so keep concurrency modest.
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  if (ocrWorker) await ocrWorker.terminate();

  console.log(found.join("\n"));
  const resolved = stats.fromTextLayer + stats.fromOcr;
  console.log("\n" + "=".repeat(66));
  console.log(`dates recovered:            ${resolved}${APPLY ? " (WRITTEN)" : " (dry run)"}`);
  console.log(`  from PDF text layer:      ${stats.fromTextLayer}`);
  console.log(`  from OCR (scanned):       ${stats.fromOcr}`);
  console.log(`no date found (had text):   ${stats.textNoDate}`);
  console.log(`no date found (scanned):    ${stats.scannedNoDate}`);
  console.log(`fetch failures:             ${stats.fetchFailed}`);
  console.log(`ocr failures:               ${stats.ocrFailed}`);
  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
