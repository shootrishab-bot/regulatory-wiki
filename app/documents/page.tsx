import Link from "next/link";
import { Crumbs } from "@/components/page-shell";
import { EntryList, Pagination } from "@/components/entry-list";
import {
  DocumentFilters,
  type ActiveFilter,
  type FilterPreset,
} from "@/components/document-filters";
import {
  listPublicEntries,
  getDomainOverview,
  getTagOptionsByRegulator,
  isSortKey,
  toList,
  SORT_OPTIONS,
  type BrowseFilters as Filters,
} from "@/lib/queries";

export const metadata = { title: "All documents · ANS" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() ? s : undefined;
}

/** A repeated query parameter, as a list: ?regulator=DOT&regulator=MIB. */
function many(v: string | string[] | undefined): string[] {
  return toList(v);
}

export function buildQuery(filters: Filters, nextPage?: number): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (k === "page" || v === undefined) continue;
    // The facet filters take several values, and each one has to be its own
    // parameter -- String(["a","b"]) would silently produce "a,b".
    if (Array.isArray(v)) {
      for (const item of v) params.append(k, item);
    } else {
      params.set(k, String(v));
    }
  }
  if (nextPage && nextPage > 1) params.set("page", String(nextPage));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

/** Same filters with some keys changed or dropped, back as a /documents URL. */
function withFilters(filters: Filters, overrides: Partial<Filters>): string {
  const next: Filters = { ...filters, ...overrides, page: undefined };
  return `/documents${buildQuery(next)}`;
}

/** yyyy-mm-dd, `days` before today, for the quick-range presets. */
function daysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}

export default async function DocumentsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const rawSort = one(sp.sort);

  const filters: Filters = {
    domain: many(sp.domain),
    regulator: many(sp.regulator),
    subject: many(sp.subject),
    instrument: many(sp.instrument),
    from: one(sp.from),
    to: one(sp.to),
    q: one(sp.q),
    sort: isSortKey(rawSort) ? rawSort : undefined,
    page: Number(one(sp.page) ?? "1") || 1,
  };

  const [{ entries, total, page, pageCount }, domains, tagsByRegulator] = await Promise.all([
    listPublicEntries(filters),
    getDomainOverview(),
    // Every regulator's tags, keyed by code. The dropdowns still only ever
    // RENDER the vocabularies of the regulators actually selected, and show
    // them under a heading each when there is more than one -- the merged,
    // unlabelled list the facet pages exist to avoid is never built.
    getTagOptionsByRegulator(),
  ]);

  // Tag ids resolve to names for the chips below. Built across every
  // regulator rather than only the selected ones, so a tag id that arrives
  // in the URL without its regulator can still be named rather than shown
  // raw.
  const tagNames = new Map<string, string>();
  for (const tags of Object.values(tagsByRegulator)) {
    for (const t of [...tags.subjects, ...tags.instrumentTypes]) tagNames.set(t.id, t.name);
  }
  const domainNames = new Map(domains.map((d) => [d.id, d.name]));

  const selectedDomains = toList(filters.domain);
  const selectedRegulators = toList(filters.regulator);
  const selectedSubjects = toList(filters.subject);
  const selectedInstruments = toList(filters.instrument);

  const presets: FilterPreset[] = [
    { label: "Last 7 days", days: 7 },
    { label: "Last 30 days", days: 30 },
    { label: "Last 3 months", days: 90 },
    { label: "Last 12 months", days: 365 },
  ].map(({ label, days }) => {
    // Bounded at both ends: a few documents carry a published date later
    // than today (shown with an "Unverified date" badge rather than being
    // corrected), and an open-ended range would file those under "last 7
    // days" alongside everything real.
    const from = daysAgo(days);
    const to = daysAgo(0);
    return {
      label,
      href: withFilters(filters, { from, to }),
      active: filters.from === from && filters.to === to,
    };
  });

  // Spelled out in words so a surprising result count explains itself, and
  // one chip per VALUE rather than per facet, so three regulators can be
  // narrowed to two without starting over.
  const drop = (list: string[], value: string) => list.filter((v) => v !== value);

  const activeFilters: ActiveFilter[] = [
    ...(filters.q
      ? [
          {
            facet: "Search",
            value: filters.q,
            removeHref: withFilters(filters, { q: undefined }),
          },
        ]
      : []),
    ...selectedDomains.map((id) => ({
      facet: "Domain",
      value: domainNames.get(id) ?? id,
      removeHref: withFilters(filters, { domain: drop(selectedDomains, id) }),
    })),
    ...selectedRegulators.map((code) => ({
      facet: "Regulator",
      value: code,
      // Dropping a regulator drops its vocabulary with it, or the page would
      // be filtering on a subject the new scope cannot show.
      removeHref: withFilters(filters, {
        regulator: drop(selectedRegulators, code),
        subject: selectedSubjects.filter((id) =>
          (tagsByRegulator[code]?.subjects ?? []).every((t) => t.id !== id)
        ),
        instrument: selectedInstruments.filter((id) =>
          (tagsByRegulator[code]?.instrumentTypes ?? []).every((t) => t.id !== id)
        ),
      }),
    })),
    ...selectedSubjects.map((id) => ({
      facet: "Subject",
      value: tagNames.get(id) ?? id,
      removeHref: withFilters(filters, { subject: drop(selectedSubjects, id) }),
    })),
    ...selectedInstruments.map((id) => ({
      facet: "Instrument",
      value: tagNames.get(id) ?? id,
      removeHref: withFilters(filters, { instrument: drop(selectedInstruments, id) }),
    })),
    ...(filters.from
      ? [
          {
            facet: "From",
            value: filters.from,
            removeHref: withFilters(filters, { from: undefined }),
          },
        ]
      : []),
    ...(filters.to
      ? [
          { facet: "To", value: filters.to, removeHref: withFilters(filters, { to: undefined }) },
        ]
      : []),
  ];

  const filtered = activeFilters.length > 0;

  return (
    <div>
      <Crumbs items={[{ label: "All documents" }]} />

      <div className="mb-6">
        <h1 className="text-[30px] leading-none font-normal text-ans-navy">All documents</h1>
        <p className="mt-3 max-w-3xl text-[16px] text-ans-body">
          Every published document across all regulators, tagged with a subject and an
          instrument type and linked back to the regulator&apos;s own file. Items still
          awaiting review are not shown.
        </p>
      </div>

      <div className="space-y-5">
        <DocumentFilters
          action="/documents"
          domains={domains}
          tagsByRegulator={tagsByRegulator}
          current={filters}
          presets={presets}
          activeFilters={activeFilters}
        />

        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <p className="text-[16px] text-ans-ink">
            <span className="font-bold">{total.toLocaleString("en-IN")}</span>{" "}
            {total === 1 ? "document" : "documents"}
            {filtered ? " match these filters" : " in the index"}
            <span className="text-ans-muted">
              {" "}
              &middot; {SORT_OPTIONS[filters.sort ?? "newest"].toLowerCase()}
            </span>
          </p>
          {filtered && (
            <Link href="/documents" className="text-[15px] text-ans-navy hover:underline">
              Clear filters
            </Link>
          )}
        </div>

        <EntryList
          entries={entries}
          emptyMessage="No published documents match these filters. Try widening the date range, or clearing a subject."
        />

        <Pagination
          page={page}
          pageCount={pageCount}
          total={total}
          buildHref={(p) => `/documents${buildQuery(filters, p)}`}
        />
      </div>
    </div>
  );
}
