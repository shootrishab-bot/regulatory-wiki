"use client";

import * as React from "react";
import { CheckToggle } from "@/components/ans/controls";
import {
  Panel,
  SectionHeading,
  SelectField,
  StatusChip,
  TextField,
  ansButton,
} from "@/components/ans/ui";
import {
  CADENCE_OPTIONS,
  SIGNATORY_OPTIONS,
  type Newsletter,
} from "@/lib/ans/demo-data";
import { cn } from "@/lib/utils";

const STATUS = {
  primary: { tone: "navy" as const, label: "Primary" },
  consented: { tone: "green" as const, label: "Consented" },
  pending: { tone: "amber" as const, label: "Consent pending" },
};

/**
 * Newsletters tab. Client-side because picking a client and flipping between
 * Setup and Preview are the two things a partner will actually do with this
 * on screen; nothing is saved.
 */
export function Newsletters({ newsletters }: { newsletters: Newsletter[] }) {
  const [selectedId, setSelectedId] = React.useState(newsletters[0].id);
  const [mode, setMode] = React.useState<"setup" | "preview">("setup");
  const selected = newsletters.find((n) => n.id === selectedId) ?? newsletters[0];

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,4fr)_minmax(0,9fr)]">
      <Panel>
        <SectionHeading>Client newsletters</SectionHeading>
        <div className="mt-4">
          {newsletters.map((n) => {
            const active = n.id === selected.id;
            return (
              <button
                key={n.id}
                type="button"
                onClick={() => setSelectedId(n.id)}
                className={cn(
                  "block w-full cursor-pointer border-t border-l-4 border-ans-line px-5 py-4 text-left transition-colors first:border-t-0",
                  active
                    ? "border-l-ans-navy bg-ans-nav"
                    : "border-l-transparent hover:bg-ans-tint"
                )}
              >
                <span className="block text-[17px] font-bold text-ans-navy">{n.client}</span>
                <span className="mt-1 block text-[14.5px] text-ans-body">{n.cadence}</span>
              </button>
            );
          })}
          <div className="border-t border-ans-line px-5 py-4">
            <button type="button" className="cursor-pointer text-[16px] text-ans-navy hover:underline">
              New newsletter
            </button>
          </div>
        </div>
      </Panel>

      <div className="space-y-6">
        <Panel>
          <SectionHeading
            action={
              <div className="flex items-center gap-3">
                <div className="flex rounded-[2px] border border-ans-navy">
                  {(["setup", "preview"] as const).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setMode(m)}
                      className={cn(
                        "cursor-pointer px-5 py-2 text-[15px] font-semibold capitalize transition-colors",
                        mode === m ? "bg-ans-navy text-white" : "bg-white text-ans-body"
                      )}
                    >
                      {m}
                    </button>
                  ))}
                </div>
                <button type="button" className={cn(ansButton.primary, "cursor-pointer py-2")}>
                  Save
                </button>
              </div>
            }
          >
            Newsletter setup
          </SectionHeading>

          <div className="px-6 pt-5 pb-6">
            <h2 className="text-[24px] font-bold text-ans-navy">{selected.client}</h2>
            <p className="mt-1 text-[15px] text-ans-body">{selected.cadence}</p>

            {mode === "setup" ? (
              <div className="mt-6 grid gap-6 sm:grid-cols-2">
                <div>
                  <p className="mb-2.5 text-[12.5px] font-bold tracking-[0.11em] text-ans-navy uppercase">
                    Cadence
                  </p>
                  <SelectField key={`${selected.id}-cadence`} defaultValue={selected.cadenceSetting} aria-label="Cadence">
                    {CADENCE_OPTIONS.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </SelectField>
                </div>
                <div>
                  <p className="mb-2.5 text-[12.5px] font-bold tracking-[0.11em] text-ans-navy uppercase">
                    Signed off by
                  </p>
                  <SelectField key={`${selected.id}-signatory`} defaultValue={selected.signedOffBy} aria-label="Signed off by">
                    {SIGNATORY_OPTIONS.map((o) => (
                      <option key={o}>{o}</option>
                    ))}
                  </SelectField>
                </div>
              </div>
            ) : (
              <div className="mt-6 border border-ans-line bg-[#fbfbfc] p-6">
                <p className="text-[13px] tracking-[0.06em] text-ans-muted uppercase">Subject</p>
                <p className="mt-1 text-[18px] font-bold text-ans-ink">
                  {selected.preview.subject}
                </p>
                <p className="mt-5 text-[16px] leading-relaxed text-ans-ink">
                  {selected.preview.intro}
                </p>
                <div className="mt-5 space-y-5">
                  {selected.preview.items.map((item) => (
                    <div key={item.title}>
                      <p className="text-[16px] font-bold text-ans-navy">{item.title}</p>
                      <p className="mt-1 text-[16px] leading-relaxed text-ans-ink">{item.body}</p>
                    </div>
                  ))}
                </div>
                <p className="mt-6 border-t border-ans-line pt-4 text-[14px] text-ans-muted">
                  Signed off by {selected.signedOffBy}. Drafted from the matters on the client
                  record; every item links back to the source instrument in the regulatory
                  library.
                </p>
              </div>
            )}
          </div>
        </Panel>

        <Panel>
          <SectionHeading
            action={
              <CheckToggle
                defaultChecked
                label="Auto-select from matter history"
                labelClassName="text-[15px]"
              />
            }
          >
            Topics covered
          </SectionHeading>
          <div className="px-6 pt-5 pb-6">
            <p className="text-[16px] leading-relaxed text-ans-body">
              Selected from {selected.mattersSince}. Untick any topic to exclude it, or switch
              off auto-selection to choose manually.
            </p>
            <div className="mt-5 space-y-4">
              {selected.topics.map((t) => (
                <div
                  key={`${selected.id}-${t.id}`}
                  className="flex items-start gap-4 border border-ans-line px-5 py-4"
                >
                  <span className="mt-0.5">
                    <CheckToggle defaultChecked={t.selected} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="text-[17px] font-bold text-ans-navy">{t.title}</p>
                    <p className="mt-1 text-[15px] text-ans-body">{t.sources}</p>
                  </div>
                  <span className="shrink-0 text-[14.5px] text-ans-muted">
                    {t.matters} matters
                  </span>
                </div>
              ))}
            </div>
          </div>
        </Panel>

        <Panel>
          <SectionHeading>Subscribers</SectionHeading>
          <div className="mt-4">
            {selected.subscribers.map((s) => (
              <div
                key={`${selected.id}-${s.id}`}
                className="flex flex-wrap items-center gap-x-6 gap-y-2 border-t border-ans-line px-6 py-4 first:border-t-0"
              >
                <CheckToggle defaultChecked={s.selected} />
                <div className="min-w-[180px] flex-1">
                  <p className="text-[17px] text-ans-ink">{s.name}</p>
                  <p className="text-[15px] text-ans-body">{s.role}</p>
                </div>
                <p className="min-w-[200px] flex-1 text-[15px] text-ans-navy">{s.email}</p>
                <StatusChip tone={STATUS[s.status].tone}>{STATUS[s.status].label}</StatusChip>
              </div>
            ))}
            <div className="border-t border-ans-line px-6 pt-5 pb-6">
              <div className="flex gap-3">
                <TextField placeholder="Add a subscriber by name or email" aria-label="Add a subscriber" />
                <button type="button" className={cn(ansButton.outline, "cursor-pointer font-semibold")}>
                  Add
                </button>
              </div>
              <p className="mt-3 text-[15px] leading-relaxed text-ans-body">
                Contacts are drawn from the client record in the CRM. Anyone added here is
                flagged for conflicts and marketing-consent checks before the first send.
              </p>
            </div>
          </div>
        </Panel>
      </div>
    </div>
  );
}
