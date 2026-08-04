import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Crumbs, PageHeader } from "@/components/page-shell";
import { EntryList, Pagination } from "@/components/entry-list";
import { getTag, listPublicEntries, isSortKey, SORT_OPTIONS, type SortKey } from "@/lib/queries";

/**
 * Documents carrying one tag. Shared by /subjects/[id] and /instruments/[id],
 * which differ only in which UpdateEntry column the tag filters on and in
 * their breadcrumb labels.
 */
export async function TagDetail({
  id,
  facet,
  page,
  sort,
}: {
  id: string;
  facet: "SUBJECT" | "INSTRUMENT_TYPE";
  page: number;
  sort?: string;
}) {
  const tag = await getTag(id);
  // Guard the facet too: a Subject id pasted into /instruments/<id> must 404
  // rather than silently render an empty, confusing "0 documents" page.
  if (!tag || tag.facet !== facet) notFound();

  const isSubject = facet === "SUBJECT";
  const sortKey: SortKey | undefined = isSortKey(sort) ? sort : undefined;

  const { entries, total, pageCount } = await listPublicEntries({
    regulator: tag.regulator.code,
    ...(isSubject ? { subject: id } : { instrument: id }),
    sort: sortKey,
    page,
  });

  const base = isSubject ? "/subjects" : "/instruments";
  const label = isSubject ? "Subjects" : "Instrument types";

  const hrefFor = (p: number, s?: string) => {
    const params = new URLSearchParams();
    if (s ?? sortKey) params.set("sort", (s ?? sortKey)!);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return `${base}/${id}${qs ? `?${qs}` : ""}`;
  };

  return (
    <div>
      <Crumbs
        items={[
          { label, href: base },
          { label: tag.regulator.code, href: `/regulators/${tag.regulator.code}` },
          { label: tag.name },
        ]}
      />
      <PageHeader
        title={tag.name}
        description={tag.definition ?? undefined}
        meta={
          <>
            <Badge variant="secondary" className="text-sm">
              {total.toLocaleString("en-IN")} published
            </Badge>
            <Link href={`/regulators/${tag.regulator.code}`}>
              <Badge variant="outline" className="cursor-pointer text-sm">
                {tag.regulator.code}
              </Badge>
            </Link>
            {tag.status !== "ACTIVE" && (
              <Badge variant="outline" className="text-sm">
                {tag.status.toLowerCase().replace("_", " ")}
              </Badge>
            )}
          </>
        }
      />

      <div className="space-y-5">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-muted-foreground">Sort:</span>
          {Object.entries(SORT_OPTIONS).map(([value, optLabel]) => (
            <Link
              key={value}
              href={hrefFor(1, value)}
              className={buttonVariants({
                variant: (sortKey ?? "newest") === value ? "secondary" : "ghost",
                size: "sm",
              })}
            >
              {optLabel}
            </Link>
          ))}
        </div>

        <EntryList entries={entries} emptyMessage="No published documents carry this tag yet." />

        <Pagination page={page} pageCount={pageCount} total={total} buildHref={(p) => hrefFor(p)} />
      </div>

      {tag.notes && (
        <details className="mt-8 rounded-xl border p-4">
          <summary className="cursor-pointer text-sm font-medium">
            Why this tag exists (curator notes)
          </summary>
          <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{tag.notes}</p>
        </details>
      )}
    </div>
  );
}
