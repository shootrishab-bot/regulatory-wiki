"use client";

import * as React from "react";
import { Chip, Dot, LevelLabel } from "@/components/ans/ui";
import type { Position } from "@/lib/ans/demo-data";
import { cn } from "@/lib/utils";

/**
 * "What has changed": one row per position taken in the matter, tested
 * against what the regulators have published since. The first position opens
 * on load the way it does in the mockup; the rest open on click, which is
 * how a reviewer actually works down the list.
 */
export function PositionList({ positions }: { positions: Position[] }) {
  const [openId, setOpenId] = React.useState<string | null>(positions[0]?.id ?? null);

  return (
    <div>
      {positions.map((p) => {
        const open = openId === p.id;
        return (
          <section key={p.id} className="border-t border-ans-line first:border-t-0">
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setOpenId(open ? null : p.id)}
              className="flex w-full cursor-pointer items-start gap-3.5 px-6 py-5 text-left transition-colors hover:bg-ans-tint"
            >
              <Dot level={p.level} />
              <span className="min-w-0 flex-1">
                <span className="block text-[17px] font-bold text-ans-navy">{p.title}</span>
                <span className="mt-1 block text-[15px] text-ans-body">{p.source}</span>
              </span>
              <span className="mt-1 shrink-0">
                <LevelLabel level={p.level}>
                  {p.level === "green" ? "Green" : p.level === "amber" ? "Amber" : "Red"}
                </LevelLabel>
              </span>
            </button>

            {open && (
              <div className="px-6 pb-6">
                <div className="grid border border-ans-line lg:grid-cols-2">
                  <div className="border-b border-ans-line p-5 lg:border-r lg:border-b-0">
                    <p className="text-[12px] font-bold tracking-[0.11em] text-ans-navy uppercase">
                      Position in the matter
                    </p>
                    <p className="mt-3 text-[16px] leading-relaxed text-ans-ink">
                      {p.matterPosition.body}
                    </p>
                    <p className="mt-4 text-[14px] text-ans-muted">{p.matterPosition.cite}</p>
                  </div>
                  <div className="p-5">
                    <p className="text-[12px] font-bold tracking-[0.11em] text-ans-cyan uppercase">
                      Current position
                    </p>
                    <p className="mt-3 text-[16px] leading-relaxed text-ans-ink">
                      {p.currentPosition.body}
                    </p>
                    <p className="mt-4 text-[14px] text-ans-muted">{p.currentPosition.cite}</p>
                  </div>
                </div>

                {p.judicial && (
                  <div className="mt-5 border-l-[3px] border-ans-navy bg-[#f4f6f7] px-6 py-5">
                    <p className="text-[12px] font-bold tracking-[0.11em] text-ans-navy uppercase">
                      Judicial consideration
                    </p>
                    <p className="mt-2 text-[15px] text-ans-body">{p.judicial.summary}</p>
                    <div className="mt-4 space-y-5">
                      {p.judicial.cases.map((c, i) => (
                        <div
                          key={c.name}
                          className={cn(i > 0 && "border-t border-ans-line pt-5")}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <p className="text-[16.5px] font-bold text-ans-navy italic">
                              {c.name}
                            </p>
                            <Chip tone={c.status.tone} className="px-2 py-[3px] text-[12.5px]">
                              {c.status.label}
                            </Chip>
                          </div>
                          <p className="mt-1 text-[15px] text-ans-body">{c.court}</p>
                          <p className="mt-2.5 text-[16px] leading-relaxed text-ans-ink">
                            {c.body}
                          </p>
                          <p className="mt-2 text-[13.5px] text-ans-muted">{c.weight}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {p.action && (
                  <p className="mt-5 flex flex-wrap gap-3 text-[16px] text-ans-ink">
                    <span className="pt-[3px] text-[12px] font-bold tracking-[0.11em] text-ans-muted uppercase">
                      Action
                    </span>
                    <span className="min-w-0 flex-1">{p.action}</span>
                  </p>
                )}
              </div>
            )}
          </section>
        );
      })}
    </div>
  );
}
