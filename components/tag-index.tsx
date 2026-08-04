import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

/**
 * Shared index for the Subject and Instrument Type facets.
 *
 * Grouped BY REGULATOR rather than presented as one flat alphabetical list.
 * That grouping is the whole point of these pages: the two facets are
 * per-regulator vocabularies that are not comparable across regulators, so a
 * merged list (what the old combined dropdown did) invites false equivalence
 * between, say, MTCTE's "Exemptions" and MIB's "Advisory".
 */
export function TagIndex({
  groups,
  hrefBase,
}: {
  groups: {
    code: string;
    name: string;
    tags: { id: string; name: string; definition: string | null; published: number }[];
  }[];
  hrefBase: string;
}) {
  return (
    <div className="space-y-6">
      {groups.map((g) => (
        <Card key={g.code}>
          <CardHeader>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <CardTitle className="text-lg">
                <Link href={`/regulators/${g.code}`} className="hover:underline">
                  {g.code}
                </Link>
                <span className="ml-2 text-base font-normal text-muted-foreground">{g.name}</span>
              </CardTitle>
              <Badge variant="secondary">{g.tags.length} tags</Badge>
            </div>
            <CardDescription className="text-sm">
              These tags apply only to {g.code} documents.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-2 sm:grid-cols-2">
              {g.tags.map((t) => (
                <Link
                  key={t.id}
                  href={`${hrefBase}/${t.id}`}
                  className="flex items-start justify-between gap-3 rounded-lg border px-3.5 py-2.5 transition-colors hover:border-foreground/25 hover:bg-muted/40"
                  title={t.definition ?? undefined}
                >
                  <span className="text-sm leading-snug">{t.name}</span>
                  <Badge variant="outline" className="shrink-0">
                    {t.published.toLocaleString("en-IN")}
                  </Badge>
                </Link>
              ))}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
