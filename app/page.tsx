import Link from "next/link";
import { AnsHeader } from "@/components/ans/app-shell";
import { Dot, Panel, SectionHeading, ansButton } from "@/components/ans/ui";
import {
  MATTER_QUEUE,
  RECENT_ALERTS,
  SCAN_SUMMARY,
  SUBSCRIPTION_SUMMARY,
} from "@/lib/ans/demo-data";
import { getPublicCountsByRegulator } from "@/lib/queries";
import { cn } from "@/lib/utils";

// Reads live Postgres counts for the library tile and must reflect an admin
// correction immediately, so it is never prerendered at build time.
export const dynamic = "force-dynamic";

/**
 * The gyaani dashboard. Horizon Scan is one module among several here, so
 * this page stays a summary: what came in overnight, what is waiting on
 * someone, and how big the tracked corpus behind it is.
 *
 * The library figures are the only live data on the page and are wrapped in a
 * try/catch on purpose -- the demo has to survive a laptop with no database,
 * and a dead tile reads better than a 500.
 */
export default async function DashboardPage() {
  let regulatorCount = 0;
  let documentCount = 0;
  let libraryAvailable = true;

  try {
    const counts = await getPublicCountsByRegulator();
    regulatorCount = counts.length;
    documentCount = counts.reduce((sum, c) => sum + c.count, 0);
  } catch {
    libraryAvailable = false;
  }

  const drafts = MATTER_QUEUE.length;

  const tiles = [
    {
      label: "Open matters scanned",
      value: SCAN_SUMMARY.openMatters.toLocaleString("en-IN"),
      detail: `${SCAN_SUMMARY.cadence.toLowerCase()} against every followed source`,
      href: "/horizon/matter-scanning",
    },
    {
      label: "Drafts awaiting review",
      value: String(drafts),
      detail: "prepared overnight, nothing sent",
      href: "/horizon/matter-scanning",
    },
    {
      label: "Sources followed",
      value: String(SUBSCRIPTION_SUMMARY.sources),
      detail: `across ${SUBSCRIPTION_SUMMARY.regulators} regulators`,
      href: "/horizon",
    },
    {
      label: "Documents in the library",
      value: libraryAvailable ? documentCount.toLocaleString("en-IN") : "—",
      detail: libraryAvailable
        ? `tagged and reviewed, across ${regulatorCount} regulators`
        : "index unavailable on this machine",
      href: "/library",
    },
  ];

  return (
    <>
      <AnsHeader title="Dashboard" />
      <div className="space-y-6 px-8 py-7">
        <p className="text-[17px] text-ans-body">
          Good morning. Here is what came in overnight.
        </p>

        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {tiles.map((t) => (
            <Link key={t.label} href={t.href}>
              <Panel className="h-full px-6 py-5 transition-colors hover:bg-ans-tint">
                <p className="text-[12.5px] font-bold tracking-[0.11em] text-ans-navy uppercase">
                  {t.label}
                </p>
                <p className="mt-3 text-[34px] leading-none font-bold text-ans-ink">{t.value}</p>
                <p className="mt-2 text-[15px] text-ans-body">{t.detail}</p>
              </Panel>
            </Link>
          ))}
        </div>

        <div className="grid items-start gap-6 xl:grid-cols-2">
          <Panel>
            <SectionHeading
              action={
                <Link href="/horizon" className="text-[15px] text-ans-navy hover:underline">
                  All alerts
                </Link>
              }
            >
              Overnight from Horizon Scan
            </SectionHeading>
            <div className="mt-5">
              {RECENT_ALERTS.slice(0, 4).map((a) => (
                <article
                  key={a.id}
                  className="flex items-start gap-3.5 border-t border-ans-line px-6 py-4 first:border-t-0"
                >
                  <Dot level={a.level} className="mt-[6px]" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[16.5px] font-bold text-ans-navy">{a.title}</p>
                    <p className="mt-1 text-[14.5px] text-ans-body">
                      {a.source} &middot; {a.when}
                    </p>
                  </div>
                </article>
              ))}
            </div>
          </Panel>

          <Panel>
            <SectionHeading
              action={
                <Link
                  href="/horizon/matter-scanning"
                  className="text-[15px] text-ans-navy hover:underline"
                >
                  Open the queue
                </Link>
              }
            >
              Drafts waiting on you
            </SectionHeading>
            <div className="mt-5">
              {MATTER_QUEUE.map((m) => (
                <article
                  key={m.id}
                  className="flex flex-wrap items-center gap-x-6 gap-y-3 border-t border-ans-line px-6 py-4 first:border-t-0"
                >
                  <Dot level={m.level} className="mt-0" />
                  <div className="min-w-[200px] flex-1">
                    <p className="text-[16.5px] font-bold text-ans-navy">{m.client}</p>
                    <p className="mt-1 text-[14.5px] text-ans-body">
                      {m.matter} &middot; {m.ref}
                    </p>
                  </div>
                  <Link
                    href={`/horizon/drafts/${m.id}`}
                    className={cn(ansButton.outline, "py-2 text-[14.5px]")}
                  >
                    Review draft
                  </Link>
                </article>
              ))}
            </div>
          </Panel>
        </div>
      </div>
    </>
  );
}
