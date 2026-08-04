import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { Crumbs, PageHeader } from "@/components/page-shell";
import { EntryList } from "@/components/entry-list";
import { getRegulatorDetail, listPublicEntries } from "@/lib/queries";

type Params = Promise<{ code: string }>;

/**
 * A regulator's own home. Everything shown here is scoped to this regulator:
 * its subjects, its instrument types, its documents. This is the page that
 * replaced cramming all three regulators' vocabularies into one dropdown.
 */
function TagGrid({
  tags,
  hrefBase,
  emptyLabel,
}: {
  tags: { id: string; name: string; definition: string | null; published: number }[];
  hrefBase: string;
  emptyLabel: string;
}) {
  if (tags.length === 0) {
    return <p className="text-sm text-muted-foreground">{emptyLabel}</p>;
  }
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {tags.map((t) => (
        <Link
          key={t.id}
          href={`${hrefBase}/${t.id}`}
          className="flex items-start justify-between gap-3 rounded-lg border px-3.5 py-2.5 transition-colors hover:border-foreground/25 hover:bg-muted/40"
        >
          <span className="text-sm leading-snug">{t.name}</span>
          <Badge variant="secondary" className="shrink-0">
            {t.published.toLocaleString("en-IN")}
          </Badge>
        </Link>
      ))}
    </div>
  );
}

export default async function RegulatorDetailPage({ params }: { params: Params }) {
  const { code } = await params;
  const detail = await getRegulatorDetail(code.toUpperCase());
  if (!detail) notFound();

  const { regulator, subjects, instrumentTypes, published, flagged } = detail;
  const recent = await listPublicEntries({ regulator: regulator.code, page: 1 });

  return (
    <div>
      <Crumbs
        items={[{ label: "Regulators", href: "/regulators" }, { label: regulator.code }]}
      />
      <PageHeader
        title={regulator.name}
        description={`All subjects and instrument types below belong to ${regulator.code} alone.`}
        meta={
          <>
            <Badge variant="secondary" className="text-sm">
              {published.toLocaleString("en-IN")} published
            </Badge>
            {flagged > 0 && (
              <Badge variant="outline" className="text-sm">
                {flagged.toLocaleString("en-IN")} awaiting review
              </Badge>
            )}
            <Link href={`/domains/${regulator.domain.id}`}>
              <Badge variant="outline" className="cursor-pointer text-sm">
                {regulator.domain.name}
              </Badge>
            </Link>
            {regulator.websiteUrl && (
              <a
                href={regulator.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
              >
                Official site <ExternalLink className="size-3.5" aria-hidden />
              </a>
            )}
          </>
        }
      />

      <div className="space-y-8">
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Subjects</CardTitle>
            </CardHeader>
            <CardContent>
              <TagGrid
                tags={subjects}
                hrefBase="/subjects"
                emptyLabel="No active subject tags for this regulator."
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Instrument types</CardTitle>
            </CardHeader>
            <CardContent>
              <TagGrid
                tags={instrumentTypes}
                hrefBase="/instruments"
                emptyLabel="No active instrument-type tags for this regulator."
              />
            </CardContent>
          </Card>
        </div>

        <Separator />

        <section>
          <div className="mb-3 flex items-baseline justify-between gap-4">
            <h2 className="text-xl font-semibold tracking-tight">
              Most recent from {regulator.code}
            </h2>
            <Link
              href={`/documents?regulator=${regulator.code}`}
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              View all {published.toLocaleString("en-IN")}
            </Link>
          </div>
          <EntryList
            entries={recent.entries.slice(0, 8)}
            emptyMessage="No published documents for this regulator yet."
          />
        </section>
      </div>
    </div>
  );
}
