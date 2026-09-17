import Link from "next/link";
import { Building2, Layers, Tags, FileType, ArrowRight } from "lucide-react";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { EntryList } from "@/components/entry-list";
import {
  listPublicEntries,
  getPublicCountsByRegulator,
  getDomainOverview,
  getTagsByFacet,
} from "@/lib/queries";

// These pages read live Postgres counts and must reflect an admin correction
// immediately, so they are never prerendered at build time.
export const dynamic = "force-dynamic";

export const metadata = { title: "Regulatory library · ANS" };

/**
 * The regulatory library hub -- the tab Horizon Scan hands over to. A HUB,
 * not a filtered list.
 *
 * The previous version put every regulator's Subject and Instrument Type
 * vocabulary into two shared dropdowns. Those vocabularies are deliberately
 * per-regulator and are not comparable across regulators, so the combined
 * lists were long and actively misleading. Each facet now gets its own entry
 * point where the options stay scoped to one regulator at a time.
 */
export default async function LibraryPage() {
  const [counts, domains, subjects, instruments, recent] = await Promise.all([
    getPublicCountsByRegulator(),
    getDomainOverview(),
    getTagsByFacet("SUBJECT"),
    getTagsByFacet("INSTRUMENT_TYPE"),
    listPublicEntries({ page: 1 }),
  ]);

  const totalDocs = counts.reduce((s, c) => s + c.count, 0);
  const totalSubjects = subjects.reduce((s, g) => s + g.tags.length, 0);
  const totalInstruments = instruments.reduce((s, g) => s + g.tags.length, 0);

  const hubs = [
    {
      href: "/regulators",
      icon: Building2,
      title: "Regulators",
      count: `${counts.length} regulators`,
      description:
        "Start from a regulator and see only its own subjects, instrument types and documents.",
    },
    {
      href: "/domains",
      icon: Layers,
      title: "Domains",
      count: `${domains.length} domains`,
      description:
        "Sector groupings. Telecom covers DoT and MTCTE; Information and Broadcasting covers MIB.",
    },
    {
      href: "/subjects",
      icon: Tags,
      title: "Subjects",
      count: `${totalSubjects} subject tags`,
      description:
        "What a document is about, grouped by regulator because each vocabulary is its own.",
    },
    {
      href: "/instruments",
      icon: FileType,
      title: "Instrument types",
      count: `${totalInstruments} instrument tags`,
      description:
        "What kind of document it is - an order, a rules notification, an advisory, a press release.",
    },
  ];

  return (
    <div className="space-y-10">
      <section>
        <Link href="/horizon" className="text-sm text-ans-navy hover:underline">
          &larr; Back to Horizon Scan
        </Link>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight text-balance">
          Indian telecom and broadcasting regulation, tracked and tagged
        </h1>
        <p className="mt-3 max-w-2xl text-base text-muted-foreground">
          {totalDocs.toLocaleString("en-IN")} published documents across {counts.length}{" "}
          regulators. Every document is tagged with a subject and an instrument type, and
          links back to the regulator&apos;s own file.
        </p>

        <form action="/documents" method="get" className="mt-5 flex max-w-xl gap-2">
          <Input
            type="search"
            name="q"
            placeholder="Search document titles..."
            aria-label="Search document titles"
            className="h-11"
          />
          <button
            type="submit"
            className={buttonVariants({ size: "lg" })}
          >
            Search
          </button>
        </form>

        <div className="mt-4 flex flex-wrap gap-2">
          {counts.map((c) => (
            <Link key={c.code} href={`/regulators/${c.code}`}>
              <Badge variant="secondary" className="cursor-pointer px-3 py-1 text-sm">
                {c.code}
                <span className="ml-1.5 text-muted-foreground">
                  {c.count.toLocaleString("en-IN")}
                </span>
              </Badge>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-xl font-semibold tracking-tight">Browse by</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          {hubs.map((h) => (
            <Link key={h.href} href={h.href} className="group">
              <Card className="h-full transition-colors group-hover:border-foreground/25 group-hover:bg-muted/40">
                <CardHeader>
                  <div className="flex items-center gap-2.5">
                    <h.icon className="size-5 text-muted-foreground" aria-hidden />
                    <CardTitle className="text-lg">{h.title}</CardTitle>
                  </div>
                  <CardDescription className="text-sm">{h.count}</CardDescription>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground">{h.description}</p>
                  <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium">
                    Browse
                    <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden />
                  </span>
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <h2 className="text-xl font-semibold tracking-tight">Most recent</h2>
          <Link href="/documents" className="text-sm text-muted-foreground hover:text-foreground">
            View all documents
          </Link>
        </div>
        <EntryList
          entries={recent.entries.slice(0, 8)}
          emptyMessage="No published documents yet."
        />
      </section>
    </div>
  );
}
