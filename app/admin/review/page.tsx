import {
  listFlaggedEntries,
  getDomainOverview,
  getTagOptionsByRegulator,
  toList,
  getFlaggedCountsByRegulator,
  isSortKey,
  type BrowseFilters as Filters,
} from "@/lib/queries";
import { requireAdminSession } from "@/lib/require-admin";
import { DocumentFilters } from "@/components/document-filters";
import { Crumbs, PageHeader } from "@/components/page-shell";
import { Badge } from "@/components/ui/badge";
import { EntryList, Pagination } from "@/components/entry-list";

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() ? s : undefined;
}

/** A repeated query parameter, as a list: ?regulator=DOT&regulator=MIB. */
function many(v: string | string[] | undefined): string[] {
  return toList(v);
}

export default async function ReviewQueuePage({ searchParams }: { searchParams: SearchParams }) {
  await requireAdminSession();

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

  const [{ entries, total, page, pageCount }, domains, tagsByRegulator, counts] =
    await Promise.all([
      listFlaggedEntries(filters),
      getDomainOverview(),
      // Keyed by regulator code so the Subject/Instrument dropdowns can swap
      // as soon as one is picked -- see components/tag-scoped-selects.tsx.
      getTagOptionsByRegulator(),
      getFlaggedCountsByRegulator(),
    ]);

  const buildHref = (nextPage: number) => {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(filters)) {
      if (k === "page" || v === undefined) continue;
      params.set(k, String(v));
    }
    if (nextPage > 1) params.set("page", String(nextPage));
    const qs = params.toString();
    return qs ? `/admin/review?${qs}` : "/admin/review";
  };

  const grandTotal = counts.reduce((sum, c) => sum + c.count, 0);

  return (
    <div className="space-y-5">
      <Crumbs items={[{ label: "Review queue" }]} />
      <PageHeader
        title="Review queue"
        description={`${grandTotal.toLocaleString("en-IN")} document${grandTotal === 1 ? "" : "s"} flagged for human review. These are hidden from the public site until resolved.`}
      />

      {counts.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {counts.map((c) => (
            <a
              key={c.code}
              href={`/admin/review?regulator=${c.code}`}
            >
              <Badge variant="secondary" className="cursor-pointer px-3 py-1 text-sm">
                {c.code}
                <span className="ml-1.5 text-muted-foreground">
                  {c.count.toLocaleString("en-IN")}
                </span>
              </Badge>
            </a>
          ))}
        </div>
      )}

      <DocumentFilters
        action="/admin/review"
        domains={domains}
        tagsByRegulator={tagsByRegulator}
        current={filters}
      />

      <EntryList
        entries={entries}
        hrefBase="/admin/review"
        emptyMessage="Nothing flagged matches these filters."
      />

      <Pagination page={page} pageCount={pageCount} total={total} buildHref={buildHref} />
    </div>
  );
}
