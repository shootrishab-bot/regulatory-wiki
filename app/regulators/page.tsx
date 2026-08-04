import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Crumbs, PageHeader } from "@/components/page-shell";
import { getDomainOverview } from "@/lib/queries";

// These pages read live Postgres counts and must reflect an admin correction
// immediately, so they are never prerendered at build time.
export const dynamic = "force-dynamic";

export default async function RegulatorsPage() {
  const domains = await getDomainOverview();
  const regulators = domains.flatMap((d) =>
    d.regulators.map((r) => ({ ...r, domain: d.name }))
  );

  return (
    <div>
      <Crumbs items={[{ label: "Regulators" }]} />
      <PageHeader
        title="Regulators"
        description="Pick a regulator to see its own subject and instrument-type vocabulary. Each regulator's taxonomy is separate and deliberately not comparable across regulators."
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {regulators.map((r) => (
          <Link key={r.code} href={`/regulators/${r.code}`} className="group">
            <Card className="h-full transition-colors group-hover:border-foreground/25 group-hover:bg-muted/40">
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-lg">{r.code}</CardTitle>
                  <Badge variant="secondary">{r.published.toLocaleString("en-IN")}</Badge>
                </div>
                <CardDescription className="text-sm">{r.name}</CardDescription>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Domain: <span className="text-foreground">{r.domain}</span>
                </p>
                <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium">
                  Open
                  <ArrowRight
                    className="size-4 transition-transform group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </span>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
