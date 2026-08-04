import Link from "next/link";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Crumbs, PageHeader } from "@/components/page-shell";
import { getDomainOverview } from "@/lib/queries";

// These pages read live Postgres counts and must reflect an admin correction
// immediately, so they are never prerendered at build time.
export const dynamic = "force-dynamic";

export default async function DomainsPage() {
  const domains = await getDomainOverview();

  return (
    <div>
      <Crumbs items={[{ label: "Domains" }]} />
      <PageHeader
        title="Domains"
        description="Sector groupings. Regulators in the same domain share a subject area, but each still keeps its own taxonomy."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        {domains.map((d) => {
          const total = d.regulators.reduce((s, r) => s + r.published, 0);
          return (
            <Card key={d.id}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-lg">
                    <Link href={`/domains/${d.id}`} className="hover:underline">
                      {d.name}
                    </Link>
                  </CardTitle>
                  <Badge variant="secondary">{total.toLocaleString("en-IN")}</Badge>
                </div>
                <CardDescription className="text-sm">
                  {d.regulators.length} regulator{d.regulators.length === 1 ? "" : "s"}
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex flex-col gap-2">
                  {d.regulators.map((r) => (
                    <Link
                      key={r.code}
                      href={`/regulators/${r.code}`}
                      className="flex items-center justify-between gap-3 rounded-lg border px-3.5 py-2.5 transition-colors hover:border-foreground/25 hover:bg-muted/40"
                    >
                      <span className="text-sm">
                        <span className="font-medium">{r.code}</span>
                        <span className="ml-2 text-muted-foreground">{r.name}</span>
                      </span>
                      <Badge variant="outline" className="shrink-0">
                        {r.published.toLocaleString("en-IN")}
                      </Badge>
                    </Link>
                  ))}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
