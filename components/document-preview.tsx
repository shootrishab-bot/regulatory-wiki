"use client";

import { useState } from "react";
import { ExternalLink, Download, FileWarning, Link2 } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { classifyFileUrl, isPdf, fileExtension } from "@/lib/file-kind";

/**
 * Document preview pane.
 *
 * A client component only because it needs the iframe's onLoad/onError to
 * surface a REAL failure state. Nothing here is a placeholder: if the file
 * cannot be shown, the pane says so and offers the source link, rather than
 * animating a skeleton that implies content is still coming.
 *
 * The frame points at our own /api/documents/[id]/file proxy rather than at
 * the regulator URL directly. That is not incidental -- MIB sends
 * X-Frame-Options: DENY and MTCTE 403s bare requests, so a direct frame
 * renders blank for most of the corpus. See the route file for the measured
 * header survey.
 */
export function DocumentPreview({
  documentId,
  fileUrl,
  sourceUrl,
  compact = false,
}: {
  documentId: string;
  fileUrl: string | null;
  sourceUrl: string | null;
  /** Shorter frame for the admin review view, where the form sits alongside. */
  compact?: boolean;
}) {
  const [failed, setFailed] = useState(false);
  const kind = classifyFileUrl(fileUrl);
  const height = compact ? "h-[420px]" : "h-[680px]";

  // ---- no file at all -----------------------------------------------------
  //
  // Not every real record IS a file. IN-SPACe's Authorizations and Data
  // Disseminator registrations (several hundred real rows) are table entries
  // on a listing page; ISRO press releases and IN-SPACe opportunities with no
  // attachment are a web page of their own. Saying only "no source file
  // recorded" left those entries looking broken, so where we hold the page
  // the record came from, it is offered here as the primary source.
  //
  // The copy deliberately does not say WHICH kind of page sourceUrl is: it
  // is the section listing for some records and the record's own detail
  // page for others, and nothing on the document tells the two apart.
  if (kind === "none") {
    return (
      <Shell>
        <Empty
          icon={<FileWarning className="size-5" aria-hidden />}
          title={sourceUrl ? "No file to preview" : "No source file recorded"}
          body={
            sourceUrl
              ? "The regulator publishes this entry as a web page rather than as a downloadable document, so there is nothing to preview here. The page it was captured from is the primary source."
              : "This entry has no file or reference link captured from the regulator's listing."
          }
          action={
            sourceUrl && (
              <a
                href={sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants({ size: "lg" })}
              >
                Open on the regulator&apos;s site
                <ExternalLink className="size-4" aria-hidden />
              </a>
            )
          }
        />
      </Shell>
    );
  }

  // ---- external reference / flipbook: never embedded ----------------------
  if (kind === "external-reference" || kind === "flipbook") {
    const target = fileUrl ?? sourceUrl;
    const isFlip = kind === "flipbook";
    return (
      <Shell>
        <Empty
          icon={<Link2 className="size-5" aria-hidden />}
          title={
            isFlip
              ? "This entry is published as an online e-book"
              : "This entry links to an external reference source rather than a downloadable file"
          }
          body={
            isFlip
              ? "The regulator publishes this as a flipbook viewer page, not as a file, so it cannot be previewed here."
              : "The regulator points to a page on another site (for example a PIB press release or India Code) instead of hosting a file, so there is nothing to preview inline."
          }
          action={
            target && (
              <a
                href={target}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants({ size: "lg" })}
              >
                Open reference source
                <ExternalLink className="size-4" aria-hidden />
              </a>
            )
          }
        />
      </Shell>
    );
  }

  // ---- real direct file ---------------------------------------------------
  const ext = fileExtension(fileUrl);
  const pdf = isPdf(fileUrl);
  const proxy = `/api/documents/${documentId}/file`;

  return (
    <div className="overflow-hidden rounded-xl border">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b bg-muted/40 px-4 py-2.5">
        <span className="text-sm font-medium">
          Document preview
          {ext && <span className="ml-2 font-mono text-xs text-muted-foreground">.{ext}</span>}
        </span>
        <div className="flex flex-wrap gap-2">
          {/* Labelled "Open Source Document", not "Download": the HTML
              `download` attribute is ignored for cross-origin URLs, so this
              link opens the regulator's file in a new tab rather than saving
              it. Promising a download here would be inaccurate. */}
          {fileUrl && (
            <a
              href={fileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              Open Source Document
              <ExternalLink className="size-4" aria-hidden />
            </a>
          )}
          {/* A genuine save, and only possible because this goes through our
              own origin with Content-Disposition: attachment. */}
          <a href={`${proxy}?download=1`} className={buttonVariants({ size: "sm" })}>
            Download
            <Download className="size-4" aria-hidden />
          </a>
        </div>
      </div>

      {failed || !pdf ? (
        <Empty
          icon={<FileWarning className="size-5" aria-hidden />}
          title={pdf ? "This file could not be displayed" : `Preview not available for .${ext} files`}
          body={
            pdf
              ? "The source did not return a viewable file. It may have been moved or the regulator's server may be unavailable."
              : "Browsers only render PDFs inline. Use the buttons above to open or download the original."
          }
          action={
            fileUrl && (
              <a
                href={fileUrl}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants({ variant: "outline", size: "lg" })}
              >
                Open source file
                <ExternalLink className="size-4" aria-hidden />
              </a>
            )
          }
        />
      ) : (
        <iframe
          src={proxy}
          title="Source document preview"
          className={cn("w-full bg-muted/20", height)}
          onError={() => setFailed(true)}
        />
      )}
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return <div className="overflow-hidden rounded-xl border">{children}</div>;
}

function Empty({
  icon,
  title,
  body,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  body: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <span className="text-muted-foreground">{icon}</span>
      <p className="text-base font-medium text-balance">{title}</p>
      <p className="max-w-md text-sm text-muted-foreground">{body}</p>
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}
