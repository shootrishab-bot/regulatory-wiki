import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { getIssuingEntity } from "@/lib/issuing-entity";
import type { EntryListItem } from "@/lib/queries";

/**
 * Dates render as DD-MM-YYYY: Indian regulators publish day-first, and the
 * stored values were rebuilt to that convention against real document
 * evidence (see scripts/rebuild-dot-dates.ts). A fixed format + UTC keeps
 * server and client output identical, so this cannot hydrate-mismatch.
 */
export function formatDate(d: Date | null): string {
  if (!d) return "No date";
  const day = String(d.getUTCDate()).padStart(2, "0");
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${day}-${month}-${d.getUTCFullYear()}`;
}

/**
 * A publishedDate later than today cannot be real. After the date rebuild no
 * document trips this, but the guard stays as a standing safety net: if a
 * future scrape reintroduces a date defect, the UI flags it instead of
 * presenting it as fact.
 */
export function isUnverifiedDate(d: Date | null): boolean {
  if (!d) return false;
  return d.getTime() > Date.now();
}

export function UnverifiedDateBadge() {
  return (
    <Badge
      variant="outline"
      title="This document's published date is later than today, which cannot be correct. It has not been verified against the source document."
      className="border-amber-500/40 text-amber-700 dark:text-amber-400"
    >
      Unverified date
    </Badge>
  );
}

/**
 * Surfaces the real issuing entity (ISRO / IN-SPACe / NSIL / DOS) for
 * regulators that bundle more than one real body under a single Regulator
 * badge -- see lib/issuing-entity.ts for why this matters and why it's
 * derived from sourceUrl rather than a stored field. Renders nothing when
 * getIssuingEntity can't resolve one (every regulator that ISN'T a
 * multi-entity bundle, or an external link), so this is inert everywhere
 * except where it's actually needed.
 */
export function IssuingEntityBadge({ sourceUrl }: { sourceUrl: string | null | undefined }) {
  const entity = getIssuingEntity(sourceUrl);
  if (!entity) return null;
  return (
    <span
      title={`Issuing entity: ${entity} (derived from the source link's domain)`}
      className="inline-flex items-center rounded-md bg-sky-500/12 px-2 py-0.5 text-xs font-medium text-sky-700 ring-1 ring-sky-500/25 ring-inset dark:text-sky-300"
    >
      {entity}
    </span>
  );
}

/**
 * Subject and Instrument Type are different KINDS of fact -- what a document
 * is about, versus what form it takes -- so they get deliberately different
 * treatments rather than two near-identical grey pills. Subject is a solid
 * indigo chip; Instrument Type is an outlined slate chip with a leading
 * marker. Both carry a title attribute naming the facet, so the distinction
 * does not rest on colour alone.
 */
export function SubjectBadge({ name }: { name: string }) {
  return (
    <span
      title={`Subject: ${name}`}
      className="inline-flex items-center rounded-md bg-indigo-500/12 px-2 py-0.5 text-xs font-medium text-indigo-700 ring-1 ring-indigo-500/25 ring-inset dark:text-indigo-300"
    >
      {name}
    </span>
  );
}

export function InstrumentBadge({ name }: { name: string }) {
  return (
    <span
      title={`Instrument type: ${name}`}
      className="inline-flex items-center gap-1.5 rounded-md border border-dashed px-2 py-0.5 text-xs font-medium text-muted-foreground"
    >
      <span className="size-1.5 rounded-full bg-muted-foreground/60" aria-hidden />
      {name}
    </span>
  );
}

/**
 * Status is now a real per-regulator TaxonomyTag name (e.g. "In Force",
 * DST's "Open / Accepting Applications"), not a fixed enum key -- so tone
 * matches on substring rather than an exact enum value, the same way a
 * human would eyeball "does this read as operative/open, or as a draft?"
 * regardless of which regulator's exact wording it is. `name` is nullable:
 * an entry can have no resolved Status tag (a genuine classification gap,
 * flagged via needsReview) the same way Subject/Instrument Type already can.
 */
export function StatusBadge({ name }: { name: string | null }) {
  if (!name) return null;
  const tone =
    name.startsWith("In Force") || name.startsWith("Open")
      ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-400"
      : name.startsWith("Draft")
        ? "border-amber-500/40 text-amber-700 dark:text-amber-400"
        : "";
  return (
    <Badge variant="outline" className={tone}>
      {name}
    </Badge>
  );
}

export function EntryList({
  entries,
  emptyMessage,
  // The admin queue links each row to its correction page instead of the
  // public detail page, so the target is a prop rather than hardcoded.
  hrefBase = "/documents",
}: {
  entries: EntryListItem[];
  emptyMessage: string;
  hrefBase?: string;
}) {
  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-dashed px-6 py-14 text-center text-base text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }

  return (
    <ul className="divide-y rounded-xl border">
      {entries.map((e) => (
        <li key={e.id} className="transition-colors hover:bg-muted/40">
          <Link href={`${hrefBase}/${e.id}`} className="block px-5 py-4">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
              <span className="font-semibold text-foreground">
                {e.sourceDocument.regulator.code}
              </span>
              <IssuingEntityBadge sourceUrl={e.sourceDocument.sourceUrl} />
              <span>{formatDate(e.sourceDocument.publishedDate)}</span>
              {isUnverifiedDate(e.sourceDocument.publishedDate) && <UnverifiedDateBadge />}
              <StatusBadge name={e.statusTag?.name ?? null} />
            </div>
            <p className="mt-1.5 text-base leading-snug">{e.title}</p>
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {e.subject && <SubjectBadge name={e.subject.name} />}
              {e.instrumentType && <InstrumentBadge name={e.instrumentType.name} />}
              {e.needsReview &&
                e.reviewReasons.map((r) => (
                  <Badge key={r} variant="destructive">
                    {r}
                  </Badge>
                ))}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

export function Pagination({
  page,
  pageCount,
  total,
  buildHref,
}: {
  page: number;
  pageCount: number;
  total: number;
  buildHref: (page: number) => string;
}) {
  if (total === 0) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 text-sm">
      <span className="text-muted-foreground">
        Page {page} of {pageCount} &middot; {total.toLocaleString("en-IN")} document
        {total === 1 ? "" : "s"}
      </span>
      {/* Plain links rather than <Button render={...}>: these are navigation,
          and a disabled button and a missing link need different markup. */}
      <div className="flex gap-2">
        {page > 1 ? (
          <Link href={buildHref(page - 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>
            Previous
          </Link>
        ) : (
          <span className={cn(buttonVariants({ variant: "outline", size: "sm" }), "pointer-events-none opacity-50")}>
            Previous
          </span>
        )}
        {page < pageCount ? (
          <Link href={buildHref(page + 1)} className={buttonVariants({ variant: "outline", size: "sm" })}>
            Next
          </Link>
        ) : (
          <span className={cn(buttonVariants({ variant: "outline", size: "sm" }), "pointer-events-none opacity-50")}>
            Next
          </span>
        )}
      </div>
    </div>
  );
}
