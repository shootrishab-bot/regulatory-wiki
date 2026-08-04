import { Crumbs, PageHeader } from "@/components/page-shell";
import { EntryList, Pagination } from "@/components/entry-list";
import { DocumentFilters } from "@/components/document-filters";
import {
  listPublicEntries,
  getRegulators,
  getTagOptions,
  isSortKey,
  type BrowseFilters as Filters,
} from "@/lib/queries";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() ? s : undefined;
}

export function buildQuery(filters: Filters, nextPage?: number): string {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(filters)) {
    if (k === "page" || v === undefined) continue;
    params.set(k, String(v));
  }
  if (nextPage && nextPage > 1) params.set("page", String(nextPage));
  const qs = params.toString();
  return qs ? `?${qs}` : "";
}

export default async function DocumentsPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const rawSort = one(sp.sort);

  const filters: Filters = {
    regulator: one(sp.regulator),
    subject: one(sp.subject),
    instrument: one(sp.instrument),
    from: one(sp.from),
    to: one(sp.to),
    q: one(sp.q),
    sort: isSortKey(rawSort) ? rawSort : undefined,
    page: Number(one(sp.page) ?? "1") || 1,
  };

  const [{ entries, total, page, pageCount }, regulators, tagOptions] = await Promise.all([
    listPublicEntries(filters),
    getRegulators(),
    // Tag options are scoped to the selected regulator so the dropdowns never
    // mix three regulators' incomparable vocabularies. With NO regulator
    // selected we deliberately fetch nothing: getTagOptions() with an
    // undefined regulatorCode returns every regulator's tags, which would
    // repopulate exactly the combined 43-option list this refactor exists to
    // remove (caught in testing -- the select was disabled but still carried
    // all three vocabularies in its markup).
    filters.regulator
      ? getTagOptions({ regulatorCode: filters.regulator, includeNonActive: false })
      : Promise.resolve({ subjects: [], instrumentTypes: [] }),
  ]);

  return (
    <div>
      <Crumbs items={[{ label: "All documents" }]} />
      <PageHeader
        title="All documents"
        description="Every published document across all regulators. Items still awaiting review are not shown."
      />

      <div className="space-y-5">
        <DocumentFilters
          action="/documents"
          regulators={regulators}
          subjects={tagOptions.subjects}
          instrumentTypes={tagOptions.instrumentTypes}
          current={filters}
        />

        <EntryList entries={entries} emptyMessage="No published documents match these filters." />

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
