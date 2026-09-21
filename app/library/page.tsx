import Link from "next/link";
import { Panel, SectionHeading } from "@/components/ans/ui";
import { EntryList } from "@/components/entry-list";
import { TagScopedSelects } from "@/components/tag-scoped-selects";
import {
  listPublicEntries,
  getPublicCountsByRegulator,
  getDomainOverview,
  getTagOptionsByRegulator,
  getTagsByFacet,
  isSortKey,
  toList,
  SORT_OPTIONS,
  type BrowseFilters,
} from "@/lib/queries";

// These pages read live Postgres counts and must reflect an admin correction
// immediately, so they are never prerendered at build time.
export const dynamic = "force-dynamic";

export const metadata = { title: "Regulatory library · ANS" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() ? s : undefined;
}

/** A repeated query parameter, as a list: ?regulator=DOT&regulator=MIB. */
function many(v: string | string[] | undefined): string[] {
  return toList(v);
}

/** Ranges for the recent-documents panel. 0 means no date filter at all. */
const RANGES = [
  { value: "7", label: "Last 7 days", words: "the last seven days" },
  { value: "30", label: "Last 30 days", words: "the last 30 days" },
  { value: "90", label: "Last 3 months", words: "the last three months" },
  { value: "365", label: "Last 12 months", words: "the last 12 months" },
  { value: "0", label: "All time", words: "the whole index" },
];

const FIELD =
  "h-9 w-full min-w-0 rounded-[2px] border border-[#c9ccd0] bg-white px-2.5 text-[14px] text-ans-ink outline-none focus:border-ans-navy disabled:bg-[#f4f5f6] disabled:text-ans-muted";
const LABEL = "mb-1 block text-[11px] font-bold tracking-[0.09em] text-ans-muted uppercase";

/**
 * The regulatory library hub -- the tab Horizon Scan hands over to.
 *
 * Built around what an associate opens this page to do, which is one of
 * three things: search for something specific, go straight to a regulator,
 * or see what has landed since they last looked. The previous version led
 * with four equal "Browse by" cards -- Regulators, Domains, Subjects,
 * Instrument types -- which is a tour of the taxonomy, not a way in. Nobody
 * arrives here wanting to browse instrument types; they arrive wanting the
 * master direction they half-remember.
 *
 * Order is search, the regulators, what is new, and the taxonomy indexes
 * last: navigation above the feed, and the vocabulary walk right at the
 * bottom where it is still one click away for the times you genuinely want
 * it.
 *
 * The recent panel filters in place, off searchParams, through the same
 * plain GET form the rest of the site uses -- so the filtered view has a
 * shareable URL, works with no JavaScript, and hands its filters straight on
 * to /documents when you want the full run rather than the first ten.
 */
export default async function LibraryPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;

  const rangeValue = RANGES.some((r) => r.value === one(sp.range)) ? one(sp.range)! : "7";
  const range = RANGES.find((r) => r.value === rangeValue)!;
  const rawSort = one(sp.sort);

  const iso = (d: Date) => d.toISOString().slice(0, 10);
  const daysAgo = (days: number) => {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - days);
    return iso(d);
  };
  // Bounded at today on purpose. A handful of documents carry a published
  // date later than today (the index shows them with an "Unverified date"
  // badge rather than correcting them), and an open-ended "from" would file
  // a 2029 date under "new this week".
  const today = iso(new Date());

  const filters: BrowseFilters = {
    domain: many(sp.domain),
    regulator: many(sp.regulator),
    subject: many(sp.subject),
    instrument: many(sp.instrument),
    from: rangeValue === "0" ? undefined : daysAgo(Number(rangeValue)),
    to: rangeValue === "0" ? undefined : today,
    sort: isSortKey(rawSort) ? rawSort : undefined,
    page: 1,
  };

  const [counts, domains, subjects, instruments, recent, tagsByRegulator] = await Promise.all([
    getPublicCountsByRegulator(),
    getDomainOverview(),
    getTagsByFacet("SUBJECT"),
    getTagsByFacet("INSTRUMENT_TYPE"),
    listPublicEntries(filters),
    // Subject and instrument vocabularies are per-regulator and not
    // comparable across regulators, so those two selects only ever render
    // the tags of the regulator currently chosen. They are all fetched up
    // front so that choosing one swaps them immediately rather than a form
    // submit later -- see components/tag-scoped-selects.tsx.
    getTagOptionsByRegulator(),
  ]);

  const totalDocs = counts.reduce((s, c) => s + c.count, 0);
  const totalSubjects = subjects.reduce((s, g) => s + g.tags.length, 0);
  const totalInstruments = instruments.reduce((s, g) => s + g.tags.length, 0);

  const narrowed =
    toList(filters.domain).length +
      toList(filters.regulator).length +
      toList(filters.subject).length +
      toList(filters.instrument).length >
    0;
  const defaultView = !narrowed && rangeValue === "7";

  // The same filters, handed on to the full index.
  const seeAll = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (k === "page" || v === undefined) continue;
    // Each value of a multi-valued facet needs its own parameter --
    // String(["a","b"]) would silently become "a,b".
    if (Array.isArray(v)) for (const item of v) seeAll.append(k, item);
    else seeAll.set(k, String(v));
  }

  const ranges = [
    { label: "Last 7 days", href: "/library?range=7#recent" },
    { label: "Last 30 days", href: "/library?range=30#recent" },
    { label: "Everything", href: "/documents" },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <Link href="/horizon" className="text-[15px] text-ans-navy hover:underline">
          &larr; Back to Horizon Scan
        </Link>
        <p className="text-[14px] text-ans-muted">
          {counts.length} regulators &middot; {totalDocs.toLocaleString("en-IN")} documents
          tagged and reviewed
        </p>
      </div>

      <Panel>
        <SectionHeading sub="Free-text over document titles. Every result links back to the regulator's own file.">
          Search the index
        </SectionHeading>
        <div className="px-6 pt-5 pb-6">
          <form action="/documents" method="get" className="flex flex-wrap gap-3">
            <input
              type="search"
              name="q"
              aria-label="Search document titles"
              placeholder="e.g. consent notice, uplinking licence, payment system data"
              className="h-11 min-w-[260px] flex-1 rounded-[2px] border border-[#c9ccd0] bg-white px-4 text-[16px] text-ans-ink outline-none placeholder:text-ans-muted focus:border-ans-navy"
            />
            <button
              type="submit"
              className="h-11 rounded-[2px] bg-ans-navy px-8 text-[16px] font-bold text-white transition-colors hover:bg-[#00537f]"
            >
              Search
            </button>
          </form>

          <div className="mt-4 flex flex-wrap gap-2">
            {ranges.map((r) => (
              <Link
                key={r.label}
                href={r.href}
                className="rounded-[2px] border border-ans-line px-3.5 py-2 text-[14.5px] text-ans-ink transition-colors hover:bg-ans-tint"
              >
                {r.label}
              </Link>
            ))}
          </div>
        </div>
      </Panel>

      <Panel>
        <SectionHeading sub="Start from a regulator and see only its own subjects, instrument types and documents.">
          Go to a regulator
        </SectionHeading>
        <div className="grid gap-x-6 gap-y-6 px-6 pt-5 pb-6 md:grid-cols-2 xl:grid-cols-3">
          {domains.map((d) => {
            // A domain heading that leads to a page listing one regulator is
            // a click that tells you nothing you could not already see. Where
            // a domain holds exactly one regulator -- which is most of them
            // here -- the heading goes straight to that regulator instead.
            const only = d.regulators.length === 1 ? d.regulators[0] : null;
            return (
              <div key={d.id}>
                <Link
                  href={only ? `/regulators/${only.code}` : `/domains/${d.id}`}
                  className="text-[12.5px] font-bold tracking-[0.09em] text-ans-orange uppercase hover:underline"
                >
                  {d.name}
                </Link>
                {/* One light box per DOMAIN, hairlines between the regulators
                    inside it -- rather than a heavy box around each of the
                    thirteen. The group is what needed a boundary (the domains
                    ran into each other when this was bare rows); the entries
                    inside only needed separating. Each is now a single 42px
                    line rather than a two-line box of about 70px plus the gap
                    between boxes. */}
                <ul className="mt-2 divide-y divide-ans-line rounded-[2px] border border-ans-line bg-white">
                  {d.regulators.map((r) => (
                    <li key={r.code}>
                      <Link
                        href={`/regulators/${r.code}`}
                        className="flex items-baseline gap-2.5 px-3.5 py-2.5 transition-colors hover:bg-ans-tint"
                      >
                        <span className="shrink-0 text-[15px] font-bold text-ans-navy">
                          {r.code}
                        </span>
                        <span
                          className="min-w-0 flex-1 truncate text-[13.5px] text-ans-body"
                          title={r.name}
                        >
                          {r.name}
                        </span>
                        <span className="shrink-0 text-[13.5px] text-ans-muted">
                          {r.published.toLocaleString("en-IN")}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      </Panel>

      <Panel id="recent">
        <SectionHeading
          sub={
            recent.total === 0
              ? `Nothing published in ${range.words} matches these filters.`
              : `${recent.total.toLocaleString("en-IN")} ${
                  recent.total === 1 ? "document" : "documents"
                } in ${range.words}${narrowed ? ", filtered" : ""}.`
          }
          action={
            <Link
              href={`/documents?${seeAll.toString()}`}
              className="text-[15px] text-ans-navy hover:underline"
            >
              See all in the index
            </Link>
          }
        >
          {defaultView ? "New this week" : "Recent documents"}
        </SectionHeading>

        <form
          action="/library"
          method="get"
          className="flex flex-wrap items-end gap-3 border-b border-ans-line px-6 pt-5 pb-5"
        >
          <div className="flex-1 basis-[150px]">
            <label htmlFor="f-range" className={LABEL}>
              Published
            </label>
            <select id="f-range" name="range" defaultValue={rangeValue} className={FIELD}>
              {RANGES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
          </div>

          <TagScopedSelects
            domains={domains}
            tagsByRegulator={tagsByRegulator}
            current={filters}
            fieldClassName={FIELD}
            labelClassName={LABEL}
            idPrefix="f"
          />

          <div className="flex-1 basis-[140px]">
            <label htmlFor="f-sort" className={LABEL}>
              Sort
            </label>
            <select id="f-sort" name="sort" defaultValue={filters.sort ?? "newest"} className={FIELD}>
              {Object.entries(SORT_OPTIONS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            className="h-9 shrink-0 rounded-[2px] bg-ans-navy px-6 text-[14.5px] font-bold text-white transition-colors hover:bg-[#00537f]"
          >
            Apply
          </button>
          {(narrowed || rangeValue !== "7") && (
            <Link
              href="/library#recent"
              className="h-9 shrink-0 self-end px-1 text-[14.5px] leading-9 text-ans-navy hover:underline"
            >
              Reset
            </Link>
          )}
        </form>

        <div className="px-6 pt-5 pb-6">
          <EntryList
            entries={recent.entries.slice(0, 10)}
            emptyMessage="Nothing matches. Try a wider date range, or clear the subject."
          />
          {recent.total > 10 && (
            <p className="mt-4 text-[15px] text-ans-body">
              Showing the first 10 of {recent.total.toLocaleString("en-IN")}.{" "}
              <Link
                href={`/documents?${seeAll.toString()}`}
                className="text-ans-navy hover:underline"
              >
                See all in the index
              </Link>
              .
            </p>
          )}
        </div>
      </Panel>

      <Panel>
        <SectionHeading sub="For the times you want to walk one regulator's own vocabulary rather than search across the index.">
          Browse the taxonomy
        </SectionHeading>
        <div className="grid gap-3 px-6 pt-5 pb-6 sm:grid-cols-2 xl:grid-cols-4">
          {[
            {
              href: "/subjects",
              title: "Subjects",
              detail: `${totalSubjects} tags · what a document is about`,
            },
            {
              href: "/instruments",
              title: "Instrument types",
              detail: `${totalInstruments} tags · an order, a notification, an advisory`,
            },
            {
              href: "/regulators",
              title: "All regulators",
              detail: `${counts.length} tracked, with their source pages`,
            },
            {
              href: "/domains",
              title: "Domains",
              detail: `${domains.length} sector groupings`,
            },
          ].map((c) => (
            <Link
              key={c.href}
              href={c.href}
              className="block rounded-[2px] border border-ans-line bg-white px-4 py-3.5 transition-colors hover:border-ans-navy hover:bg-ans-tint"
            >
              <span className="block text-[16px] font-bold text-ans-navy">{c.title}</span>
              <span className="mt-0.5 block text-[14px] leading-snug text-ans-body">
                {c.detail}
              </span>
            </Link>
          ))}
        </div>
      </Panel>
    </div>
  );
}
