import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Crumbs, PageHeader } from "@/components/page-shell";
import { getDomainOverview } from "@/lib/queries";

type Params = Promise<{ id: string }>;

export default async function DomainDetailPage({ params }: { params: Params }) {
  const { id } = await params;
  const domains = await getDomainOverview();
  const domain = domains.find((d) => d.id === id);
  if (!domain) notFound();

  const total = domain.regulators.reduce((s, r) => s + r.published, 0);

  return (
    <div>
      <Crumbs items={[{ label: "Domains", href: "/domains" }, { label: domain.name }]} />
      <PageHeader
        title={domain.name}
        description="Regulators in this domain. Open one to browse its own subjects and instrument types."
        meta={
          <Badge variant="secondary" className="text-sm">
            {total.toLocaleString("en-IN")} published documents
          </Badge>
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {domain.regulators.map((r) => (
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
                <span className="inline-flex items-center gap-1 text-sm font-medium">
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
