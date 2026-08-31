import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight, Building2, ExternalLink, Layers } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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

  const {
    regulator,
    subjects,
    instrumentTypes,
    published,
    flagged,
    siblings,
    domainRegulators,
    domainPublished,
  } = detail;
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
        {/* Where this regulator sits: its domain, and the peers inside it. The
            two facets the top nav can only offer as full lists. */}
        <div className="grid gap-4 sm:grid-cols-2">
          <Link href={`/domains/${regulator.domain.id}`} className="group">
            <Card className="h-full transition-colors group-hover:border-foreground/25 group-hover:bg-muted/40">
              <CardHeader>
                <div className="flex items-center gap-2.5">
                  <Layers className="size-5 text-muted-foreground" aria-hidden />
                  <CardTitle className="text-lg">{regulator.domain.name}</CardTitle>
                </div>
                <CardDescription className="text-sm">
                  {domainRegulators} {domainRegulators === 1 ? "regulator" : "regulators"} &middot;{" "}
                  {domainPublished.toLocaleString("en-IN")} published
                </CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  The domain {regulator.code} belongs to.
                </p>
                <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium">
                  Browse domain
                  <ArrowRight
                    className="size-4 transition-transform group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </span>
              </CardContent>
            </Card>
          </Link>

          <Card className="h-full">
            <CardHeader>
              <div className="flex items-center gap-2.5">
                <Building2 className="size-5 text-muted-foreground" aria-hidden />
                <CardTitle className="text-lg">Other regulators</CardTitle>
              </div>
              <CardDescription className="text-sm">
                {siblings.length > 0
                  ? `${siblings.length} more in ${regulator.domain.name}`
                  : `None — ${regulator.code} is alone in ${regulator.domain.name}`}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {siblings.length > 0 ? (
                <div className="flex flex-wrap gap-2">
                  {siblings.map((r) => (
                    <Link key={r.code} href={`/regulators/${r.code}`} title={r.name}>
                      <Badge
                        variant="secondary"
                        className="cursor-pointer px-3 py-1 text-sm transition-colors hover:bg-muted"
                      >
                        {r.code}
                        <span className="ml-1.5 text-muted-foreground">
                          {r.published.toLocaleString("en-IN")}
                        </span>
                      </Badge>
                    </Link>
                  ))}
                </div>
              ) : (
                <Link
                  href="/regulators"
                  className="inline-flex items-center gap-1 text-sm font-medium"
                >
                  See all regulators
                  <ArrowRight className="size-4" aria-hidden />
                </Link>
              )}
            </CardContent>
          </Card>
        </div>

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
