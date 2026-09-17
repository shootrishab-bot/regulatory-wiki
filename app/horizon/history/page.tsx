import Link from "next/link";
import { Dot, Panel, SectionHeading } from "@/components/ans/ui";
import { HISTORY } from "@/lib/ans/demo-data";

export const metadata = { title: "History · Horizon Scan" };

export default function HistoryPage() {
  return (
    <div className="max-w-5xl">
      <Panel>
        <SectionHeading sub="Everything Horizon Scan has done on this account: scans run, drafts prepared, alerts and newsletters sent. Drafts stay here until someone approves or discards them.">
          History
        </SectionHeading>
        <div className="mt-5">
          {HISTORY.map((h) => (
            <article
              key={h.id}
              className="flex flex-wrap items-start gap-x-8 gap-y-3 border-t border-ans-line px-6 py-5 first:border-t-0"
            >
              <Dot level={h.level} />
              <div className="min-w-[260px] flex-1">
                <h3 className="text-[17px] font-bold text-ans-navy">
                  {h.href ? (
                    <Link href={h.href} className="hover:underline">
                      {h.title}
                    </Link>
                  ) : (
                    h.title
                  )}
                </h3>
                <p className="mt-1 text-[15px] text-ans-body">{h.kind}</p>
                <p className="mt-2.5 text-[16px] leading-relaxed text-ans-ink">{h.body}</p>
              </div>
              <div className="shrink-0 text-right">
                <p className="text-[14px] text-ans-muted">{h.when}</p>
                <p className="mt-1 text-[15px] text-ans-ink">{h.outcome}</p>
              </div>
            </article>
          ))}
        </div>
      </Panel>
    </div>
  );
}
