import type { NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { isDirectFile } from "@/lib/file-kind";

/**
 * Streams a document's real source file through our own origin.
 *
 * WHY A PROXY IS NECESSARY (measured, not assumed -- 2026-08-03)
 * --------------------------------------------------------------
 * A plain <iframe src={fileUrl}> silently fails for most of this corpus,
 * because the publishers send framing headers:
 *
 *   DoT PDFs      no X-Frame-Options            -> would embed fine
 *   MIB PDFs      X-Frame-Options: DENY         -> browser BLOCKS the frame
 *   MIB flipbook  X-Frame-Options: DENY         -> blocked
 *   MTCTE PDFs    403 to a bare request, SAMEORIGIN
 *   PIB pages     SAMEORIGIN + 401              -> blocked, and needs a session
 *
 * That is 520 MIB direct PDFs plus all of MTCTE that would render as a blank
 * frame. Worse, a cross-origin frame failure is not reliably detectable from
 * JavaScript, so the page could not even show an honest error -- it would
 * just look broken.
 *
 * Fetching server-side sidesteps this legitimately: X-Frame-Options is a
 * browser-side directive and does not apply to a server fetch. Verified by
 * really fetching both a MIB and an MTCTE PDF here and confirming the %PDF-
 * magic bytes. Re-serving from our origin then makes the frame same-origin,
 * so it embeds uniformly for every regulator.
 *
 * SSRF SAFETY: this route never accepts a URL. It accepts a SourceDocument
 * id, looks the URL up in our own database, and refuses anything that is not
 * an http(s) URL ending in a known document extension. A caller cannot point
 * it at an arbitrary host or at an internal address.
 */

// Some publishers (MTCTE) 403 a bare request; a normal browser UA gets a 200.
const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36";

const FETCH_TIMEOUT_MS = 30_000;

/** Used to tell a real filename from an endpoint name in the URL. */
const DOCUMENT_NAME = /\.(pdf|xlsx|xls|csv|docx?|pptx?)$/i;

export async function GET(req: NextRequest, ctx: RouteContext<"/api/documents/[id]/file">) {
  const { id } = await ctx.params;

  const doc = await prisma.sourceDocument.findUnique({
    where: { id },
    select: { fileUrl: true, title: true },
  });

  if (!doc?.fileUrl) {
    return new Response("No source file recorded for this document.", { status: 404 });
  }
  // Only ever proxy things we classify as a real downloadable file. External
  // reference pages are opened directly in a new tab by the UI instead.
  if (!isDirectFile(doc.fileUrl)) {
    return new Response("This document has no directly embeddable file.", { status: 415 });
  }

  let target: URL;
  try {
    target = new URL(doc.fileUrl);
  } catch {
    return new Response("Stored file URL is not a valid URL.", { status: 502 });
  }
  if (target.protocol !== "https:" && target.protocol !== "http:") {
    return new Response("Unsupported URL scheme.", { status: 400 });
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const upstream = await fetch(target, {
      headers: { "User-Agent": UA, Accept: "application/pdf,*/*" },
      signal: controller.signal,
      redirect: "follow",
    });

    if (!upstream.ok || !upstream.body) {
      // Surfaced to the user as a real error state with a link to the
      // original source -- never as a spinner that never resolves.
      return new Response(`Source responded ${upstream.status}.`, { status: 502 });
    }

    // Trust our own extension classification over the upstream content-type:
    // MTCTE serves real PDFs as APPLICATION/OCTET-STREAM, which browsers will
    // download rather than render inline.
    const isPdf = /\.pdf(\?.*)?$/i.test(target.pathname + target.search);
    const contentType = isPdf
      ? "application/pdf"
      : (upstream.headers.get("content-type") ?? "application/octet-stream");

    // ?download=1 forces a real save dialog. This works precisely BECAUSE the
    // response now comes from our own origin -- the HTML `download` attribute
    // is ignored for cross-origin URLs, so linking straight at the regulator
    // could never have produced a genuine download.
    const wantsDownload = req.nextUrl.searchParams.get("download") === "1";
    // MTCTE serves files as /filedownload?name=<real>.pdf, so the path's last
    // segment is the endpoint name, not the document. Prefer a ?name= param
    // when it looks like a real filename.
    const nameParam = target.searchParams.get("name");
    const rawName =
      nameParam && DOCUMENT_NAME.test(nameParam)
        ? nameParam
        : target.pathname.split("/").pop() || "document.pdf";
    const filename = decodeURIComponent(rawName);

    const headers = new Headers({
      "Content-Type": contentType,
      "Content-Disposition": `${wantsDownload ? "attachment" : "inline"}; filename="${filename.replace(/"/g, "")}"`,
      "Cache-Control": "public, max-age=3600",
      "X-Content-Type-Options": "nosniff",
    });
    const len = upstream.headers.get("content-length");
    if (len) headers.set("Content-Length", len);

    return new Response(upstream.body, { status: 200, headers });
  } catch (err) {
    const aborted = err instanceof Error && err.name === "AbortError";
    return new Response(aborted ? "Source timed out." : "Could not reach the source.", {
      status: 504,
    });
  } finally {
    clearTimeout(timer);
  }
}
