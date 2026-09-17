import {
  Dot,
  FieldLabel,
  Panel,
  SectionHeading,
  SelectField,
  TextField,
} from "@/components/ans/ui";
import { CheckToggle, RadioList } from "@/components/ans/controls";
import { SourceList } from "@/components/ans/source-list";
import {
  CURRENT_USER,
  FREQUENCY_OPTIONS,
  RECENT_ALERTS,
  REGULATORS,
  SIGNIFICANCE_OPTIONS,
  SUBSCRIPTION_SUMMARY,
} from "@/lib/ans/demo-data";

export const metadata = { title: "Alerts · Horizon Scan" };

export default function AlertsPage() {
  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,5fr)_minmax(0,8fr)]">
      <Panel>
        <SectionHeading>Delivery</SectionHeading>
        <div className="space-y-6 px-6 pt-5 pb-6">
          <div className="space-y-2.5">
            <FieldLabel>Send alerts to</FieldLabel>
            <TextField type="email" defaultValue={CURRENT_USER.email} aria-label="Send alerts to" />
          </div>

          <div className="space-y-3">
            <FieldLabel>Frequency</FieldLabel>
            <RadioList name="frequency" options={FREQUENCY_OPTIONS} defaultValue="daily" />
          </div>

          <div className="space-y-3">
            <FieldLabel>Also deliver to</FieldLabel>
            <div className="space-y-3">
              <CheckToggle className="flex" defaultChecked label="Teams" />
              <CheckToggle className="flex" defaultChecked label="Gyaani dashboard" />
              <CheckToggle className="flex" label="Outlook rule — file to folder" />
            </div>
          </div>

          <div className="space-y-2.5">
            <FieldLabel>Minimum significance</FieldLabel>
            <SelectField defaultValue={SIGNIFICANCE_OPTIONS[0]} aria-label="Minimum significance">
              {SIGNIFICANCE_OPTIONS.map((o) => (
                <option key={o}>{o}</option>
              ))}
            </SelectField>
          </div>

          <div className="border-t border-ans-line pt-5">
            <p className="text-[15px] leading-relaxed text-ans-body">
              You are subscribed to {SUBSCRIPTION_SUMMARY.sources} sources across{" "}
              {SUBSCRIPTION_SUMMARY.regulators} regulators. Alerts are sent only where a
              source has published since the last send.
            </p>
          </div>
        </div>
      </Panel>

      <div className="space-y-6">
        <Panel>
          <SectionHeading sub="Tick a regulator to follow every source, or open it to choose individual pages.">
            Subscriptions
          </SectionHeading>
          <SourceList regulators={REGULATORS} columns={3} />
        </Panel>

        <Panel>
          <SectionHeading>Recent alerts</SectionHeading>
          <div className="mt-5">
            {RECENT_ALERTS.map((a) => (
              <article
                key={a.id}
                className="border-t border-ans-line px-6 py-5 first:border-t-0"
              >
                <div className="flex items-start gap-3.5">
                  <Dot level={a.level} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                      <h3 className="text-[17px] font-bold text-ans-navy">{a.title}</h3>
                      <span className="text-[14px] whitespace-nowrap text-ans-muted">
                        {a.when}
                      </span>
                    </div>
                    <p className="mt-1 text-[15px] text-ans-body">{a.source}</p>
                    <p className="mt-3 text-[16px] leading-relaxed text-ans-ink">{a.body}</p>
                  </div>
                </div>
              </article>
            ))}
          </div>
        </Panel>
      </div>
    </div>
  );
}
