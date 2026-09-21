import Link from "next/link";
import { cn } from "@/lib/utils";
import { getIssuingEntity } from "@/lib/issuing-entity";
import { tagTone, toneCycle, type TagTone } from "@/lib/tag-tone";
import type { EntryListItem } from "@/lib/queries";

/**
 * The document row, shared by every list in the library and by the admin
 * review queue.
 *
 * Rewritten for the ANS shell: the title now LEADS the row. It used to sit
 * third, under a meta line of regulator/date/status, which meant scanning a
 * page of results was scanning a column of dates for the one line that
 * actually says what the document is. An associate scans titles; everything
 * else is qualification, and reads underneath.
 *
 * The badge semantics from the previous version are kept deliberately --
 * Subject and Instrument Type are different KINDS of fact (what a document
 * is about, versus what form it takes) and still get different treatments,
 * each with a title attribute naming its facet so the distinction never
 * rests on colour alone.
 *
 * WITHIN each facet the chips are now individually coloured, by a stable
 * hash of the tag name (see lib/tag-tone.ts). Twenty-five rows of one
 * identical subject colour told you nothing about whether you were looking
 * at one subject or eight; different hues make that legible at a glance. The
 * colours mean nothing in themselves -- only Status keeps a palette that
 * actually signifies something.
 */

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

const CHIP = "inline-flex items-center rounded-[2px] px-2 py-[3px] text-[12.5px] leading-none";

export function UnverifiedDateBadge() {
  return (
    <span
      title="This date is later than today, which cannot be right for a published document. It is shown exactly as the regulator published it, not corrected or guessed at."
      className={cn(CHIP, "border border-ans-amber text-ans-amber")}
    >
      Unverified date
    </span>
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
      className={cn(CHIP, "border border-ans-cyan text-ans-cyan")}
    >
      {entity}
    </span>
  );
}

export function SubjectBadge({ name, tone }: { name: string; tone?: TagTone }) {
  return (
    <span
      title={`Subject: ${name}`}
      className={cn(CHIP, "font-medium", (tone ?? tagTone(name)).solid)}
    >
      {name}
    </span>
  );
}

export function InstrumentBadge({ name, tone }: { name: string; tone?: TagTone }) {
  const t = tone ?? tagTone(name);
  return (
    <span title={`Instrument type: ${name}`} className={cn(CHIP, "gap-1.5 border", t.outline)}>
      <span className={cn("size-1.5 rounded-full", t.dot)} aria-hidden />
      {name}
    </span>
  );
}

/**
 * Status is a real per-regulator TaxonomyTag name (e.g. "In Force", DST's
 * "Open / Accepting Applications"), not a fixed enum key -- so tone matches
 * on substring rather than an exact enum value, the same way a human would
 * eyeball "does this read as operative/open, or as a draft?" regardless of
 * which regulator's exact wording it is. `name` is nullable: an entry can
 * have no resolved Status tag (a genuine classification gap, flagged via
 * needsReview) the same way Subject/Instrument Type already can.
 */
export function StatusBadge({ name }: { name: string | null }) {
  if (!name) return null;
  const tone =
    name.startsWith("In Force") || name.startsWith("Open")
      ? "border-ans-green text-ans-green"
      : name.startsWith("Draft")
        ? "border-ans-amber text-ans-amber"
        : "border-ans-line text-ans-body";
  return <span className={cn(CHIP, "border", tone)}>{name}</span>;
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
      <div className="rounded-[2px] border border-dashed border-ans-line bg-white px-6 py-14 text-center text-[16px] text-ans-muted">
        {emptyMessage}
      </div>
    );
  }

  // Tones are handed out across THIS list rather than hashed per name, so two
  // different subjects in the same result set can never come out the same
  // colour. The instrument cycle starts half a palette away so the two chips
  // on one row do not habitually match each other.
  const subjectTone = toneCycle(entries.map((e) => e.subject?.name));
  const instrumentTone = toneCycle(entries.map((e) => e.instrumentType?.name), 6);

  return (
    <ul className="divide-y divide-ans-line rounded-[2px] border border-ans-line bg-white">
      {entries.map((e) => (
        <li key={e.id} className="transition-colors hover:bg-ans-tint">
          <Link href={`${hrefBase}/${e.id}`} className="block px-5 py-4">
            <p className="text-[16.5px] leading-snug font-bold text-ans-navy">{e.title}</p>

            <div className="mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-[14px] text-ans-body">
              <span className="font-bold text-ans-ink">{e.sourceDocument.regulator.code}</span>
              <span aria-hidden className="text-ans-line">
                |
              </span>
              <span>{formatDate(e.sourceDocument.publishedDate)}</span>
              {isUnverifiedDate(e.sourceDocument.publishedDate) && <UnverifiedDateBadge />}
              <IssuingEntityBadge sourceUrl={e.sourceDocument.sourceUrl} />
              <StatusBadge name={e.statusTag?.name ?? null} />
              {e.subject && (
                <SubjectBadge name={e.subject.name} tone={subjectTone(e.subject.name)} />
              )}
              {e.instrumentType && (
                <InstrumentBadge
                  name={e.instrumentType.name}
                  tone={instrumentTone(e.instrumentType.name)}
                />
              )}
              {e.needsReview &&
                e.reviewReasons.map((r) => (
                  <span key={r} className={cn(CHIP, "border border-ans-red text-ans-red")}>
                    {r}
                  </span>
                ))}
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}

/**
 * Windowed page numbers, not just Previous/Next. 6,000-plus documents across
 * 250-odd pages is too many to walk a page at a time, and the previous
 * control gave no way to jump or even to see where you were in the run.
 */
function pageWindow(page: number, pageCount: number): (number | "gap")[] {
  if (pageCount <= 7) return Array.from({ length: pageCount }, (_, i) => i + 1);
  const out: (number | "gap")[] = [1];
  const from = Math.max(2, page - 1);
  const to = Math.min(pageCount - 1, page + 1);
  if (from > 2) out.push("gap");
  for (let p = from; p <= to; p++) out.push(p);
  if (to < pageCount - 1) out.push("gap");
  out.push(pageCount);
  return out;
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

  const step =
    "inline-flex h-9 min-w-9 items-center justify-center rounded-[2px] border border-ans-line bg-white px-3 text-[14px] text-ans-ink transition-colors hover:bg-ans-tint";
  const dead = "pointer-events-none opacity-40";

  return (
    <div className="flex flex-wrap items-center justify-between gap-4 text-[14px]">
      <span className="text-ans-body">
        Page {page} of {pageCount} &middot; {total.toLocaleString("en-IN")} document
        {total === 1 ? "" : "s"}
      </span>
      {/* Plain links rather than <Button render={...}>: these are navigation,
          and a disabled button and a missing link need different markup. */}
      <div className="flex flex-wrap items-center gap-1.5">
        {page > 1 ? (
          <Link href={buildHref(page - 1)} className={step}>
            Previous
          </Link>
        ) : (
          <span className={cn(step, dead)}>Previous</span>
        )}
        {pageWindow(page, pageCount).map((p, i) =>
          p === "gap" ? (
            <span key={`gap-${i}`} className="px-1 text-ans-muted">
              &hellip;
            </span>
          ) : p === page ? (
            <span
              key={p}
              aria-current="page"
              className={cn(step, "border-ans-navy bg-ans-navy font-bold text-white")}
            >
              {p}
            </span>
          ) : (
            <Link key={p} href={buildHref(p)} className={step}>
              {p}
            </Link>
          )
        )}
        {page < pageCount ? (
          <Link href={buildHref(page + 1)} className={step}>
            Next
          </Link>
        ) : (
          <span className={cn(step, dead)}>Next</span>
        )}
      </div>
    </div>
  );
}
