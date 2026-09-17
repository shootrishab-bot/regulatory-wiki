import Link from "next/link";
import { Chip, Dot, Panel, SectionHeading, SelectField, ansButton } from "@/components/ans/ui";
import { PositionList } from "@/components/ans/positions";
import { SourceList } from "@/components/ans/source-list";
import {
  MATTER_QUEUE,
  MATTER_TEST,
  REGULATORS,
  SCAN_SUMMARY,
  SUBSCRIPTION_SUMMARY,
  TEST_SUMMARY,
} from "@/lib/ans/demo-data";
import { cn } from "@/lib/utils";

export const metadata = { title: "Matter scanning · Horizon Scan" };

export default function MatterScanningPage() {
  return (
    <div className="space-y-6">
      <Panel>
        <SectionHeading sub="Matters whose positions are affected by something published since the advice was filed. Drafts are prepared automatically and held for review.">
          Auto-detected queue
        </SectionHeading>
        <p className="px-6 pt-4 pb-5 text-[15px] text-ans-muted">
          {SCAN_SUMMARY.cadence} &middot; {SCAN_SUMMARY.openMatters} open matters
        </p>

        {MATTER_QUEUE.map((m) => (
          <article
            key={m.id}
            className="flex flex-wrap items-start gap-x-8 gap-y-4 border-t border-ans-line px-6 py-6"
          >
            <Dot level={m.level} />
            <div className="min-w-[260px] flex-1">
              <h3 className="text-[18px] font-bold text-ans-navy">
                {m.client} &mdash; {m.matter}
              </h3>
              <p className="mt-1 text-[15px] text-ans-body">
                {m.ref} &middot; Partner: {m.partner}
              </p>
              <p className="mt-3 max-w-3xl text-[16px] leading-relaxed text-ans-ink">{m.body}</p>
            </div>
            <div className="flex shrink-0 flex-col items-end gap-2">
              <p className="text-[12px] font-bold tracking-[0.09em] uppercase">
                {m.counts.red > 0 && <span className="text-ans-red">{m.counts.red} red</span>}
                {m.counts.red > 0 && m.counts.amber > 0 && (
                  <span className="text-ans-muted"> &middot; </span>
                )}
                {m.counts.amber > 0 && (
                  <span className="text-ans-amber">{m.counts.amber} amber</span>
                )}
              </p>
              <p className="text-[14px] text-ans-muted">{m.detected}</p>
              <Link href={`/horizon/drafts/${m.id}`} className={cn(ansButton.primary, "mt-1")}>
                Review draft
              </Link>
              <button type="button" className="cursor-pointer text-[15px] text-ans-navy hover:underline">
                Dismiss
              </button>
            </div>
          </article>
        ))}
      </Panel>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,4fr)_minmax(0,9fr)]">
        <Panel>
          <SectionHeading
            sub={`${SUBSCRIPTION_SUMMARY.regulators} regulators · ${SUBSCRIPTION_SUMMARY.sources} sources`}
            subPosition="above"
          >
            1 &middot; Regulators &amp; sources
          </SectionHeading>
          <SourceList regulators={REGULATORS} columns={1} bulkActions maxHeight="max-h-[520px]" />
        </Panel>

        <div className="space-y-6">
          <Panel>
            <SectionHeading>2 &middot; Matter or document to test</SectionHeading>
            <div className="px-6 pt-5 pb-6">
              <div className="border border-ans-line border-l-[3px] border-l-ans-navy px-6 py-5">
                <h3 className="text-[19px] font-bold text-ans-navy">
                  {MATTER_TEST.client} &mdash; {MATTER_TEST.matter}
                </h3>
                <p className="mt-1 text-[15px] text-ans-body">
                  {MATTER_TEST.ref} &middot; Partner: {MATTER_TEST.partner} &middot;{" "}
                  {MATTER_TEST.documentCount} documents &middot; last filed{" "}
                  {MATTER_TEST.lastFiled}
                </p>
                <div className="mt-4 flex flex-wrap gap-3">
                  {MATTER_TEST.documents.map((d) => (
                    <Chip key={d}>{d}</Chip>
                  ))}
                  <Chip>+{MATTER_TEST.moreDocuments} more</Chip>
                </div>
                <button type="button" className="mt-5 cursor-pointer text-[16px] text-ans-navy hover:underline">
                  Change
                </button>
              </div>

              <div className="mt-6 flex flex-wrap items-center justify-between gap-4 border-t border-ans-line pt-6">
                <div className="flex flex-wrap items-center gap-4">
                  <p className="text-[16px] text-ans-body">Compare against changes since</p>
                  <SelectField
                    defaultValue={MATTER_TEST.comparedSince}
                    aria-label="Compare against changes since"
                    className="w-auto min-w-[320px]"
                  >
                    {MATTER_TEST.comparedSinceOptions.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </SelectField>
                </div>
                <button type="button" className={cn(ansButton.primary, "cursor-pointer")}>
                  Run again
                </button>
              </div>
            </div>
          </Panel>

          <Panel>
            <SectionHeading
              sub={`${TEST_SUMMARY.positions} positions tested across ${MATTER_TEST.regulatorsTested} regulators · changes since ${MATTER_TEST.comparedSinceLabel}`}
              action={
                <Link href={`/horizon/drafts/${MATTER_TEST.id}`} className={ansButton.primary}>
                  Draft client email
                </Link>
              }
            >
              3 &middot; What has changed
            </SectionHeading>
            <p className="px-6 pt-4 pb-5 text-[15px]">
              <span className="text-ans-red">{TEST_SUMMARY.red} red</span>
              <span className="text-ans-muted"> &middot; </span>
              <span className="text-ans-amber">{TEST_SUMMARY.amber} amber</span>
              <span className="text-ans-muted"> &middot; {TEST_SUMMARY.unchanged} unchanged</span>
            </p>
            <PositionList positions={MATTER_TEST.positions} />
          </Panel>
        </div>
      </div>
    </div>
  );
}
