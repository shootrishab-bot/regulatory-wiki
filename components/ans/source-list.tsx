"use client";

import * as React from "react";
import { CheckBox } from "@/components/ans/ui";
import type { RegulatorSource } from "@/lib/ans/demo-data";
import { cn } from "@/lib/utils";

/**
 * The regulator / source picker. It appears twice in the mockup -- wide, in
 * the Subscriptions card on Alerts, and narrow, as step 1 of matter scanning
 * -- so it is one component with a `columns` prop for the sub-source grid.
 *
 * Ticking a regulator ticks all of its source pages; opening one lets you
 * pick individual pages, which is the distinction the copy in the mockup
 * draws ("Tick a regulator to follow every source, or open it to choose
 * individual pages").
 */

interface RowState {
  expanded: boolean;
  sources: Record<string, boolean>;
}

const PRESET = {
  label: "Data & technology",
  codes: ["MeitY", "CERT-In", "UIDAI", "RBI", "TRAI"],
};

function initialState(regulators: RegulatorSource[]): Record<string, RowState> {
  return Object.fromEntries(
    regulators.map((r) => [
      r.code,
      {
        expanded: Boolean(r.expanded),
        sources: Object.fromEntries(r.sources.map((s) => [s, r.selected])),
      },
    ])
  );
}

export function SourceList({
  regulators,
  columns = 3,
  searchPlaceholder = "Search regulator or source",
  bulkActions = false,
  maxHeight = "max-h-[430px]",
}: {
  regulators: RegulatorSource[];
  columns?: 1 | 3;
  searchPlaceholder?: string;
  bulkActions?: boolean;
  maxHeight?: string;
}) {
  const [state, setState] = React.useState(() => initialState(regulators));
  const [query, setQuery] = React.useState("");

  const setAll = (code: string, value: boolean) =>
    setState((s) => ({
      ...s,
      [code]: {
        ...s[code],
        sources: Object.fromEntries(Object.keys(s[code].sources).map((k) => [k, value])),
      },
    }));

  const toggleSource = (code: string, source: string) =>
    setState((s) => ({
      ...s,
      [code]: {
        ...s[code],
        sources: { ...s[code].sources, [source]: !s[code].sources[source] },
      },
    }));

  const toggleExpanded = (code: string) =>
    setState((s) => ({ ...s, [code]: { ...s[code], expanded: !s[code].expanded } }));

  const bulk = (codes: string[] | null) =>
    setState((s) =>
      Object.fromEntries(
        Object.entries(s).map(([code, row]) => [
          code,
          {
            ...row,
            sources: Object.fromEntries(
              Object.keys(row.sources).map((k) => [k, codes ? codes.includes(code) : false])
            ),
          },
        ])
      )
    );

  const needle = query.trim().toLowerCase();
  const visible = needle
    ? regulators.filter(
        (r) =>
          r.code.toLowerCase().includes(needle) ||
          r.name.toLowerCase().includes(needle) ||
          r.sources.some((s) => s.toLowerCase().includes(needle))
      )
    : regulators;

  return (
    <div>
      <div className="px-6 pt-5 pb-4">
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          className="w-full rounded-[2px] border border-[#c9ccd0] px-3.5 py-2.5 text-[15px] outline-none placeholder:text-ans-muted focus:border-ans-navy"
        />
        {bulkActions && (
          <div className="mt-3 flex flex-wrap gap-5 text-[15px]">
            <button type="button" className="text-ans-navy hover:underline" onClick={() => bulk(regulators.map((r) => r.code))}>
              Select all
            </button>
            <button type="button" className="text-ans-navy hover:underline" onClick={() => bulk(null)}>
              Clear
            </button>
            <button type="button" className="text-ans-navy hover:underline" onClick={() => bulk(PRESET.codes)}>
              Preset: {PRESET.label}
            </button>
          </div>
        )}
      </div>

      <div className={cn("overflow-y-auto border-t border-ans-line", maxHeight)}>
        {visible.map((r) => {
          const row = state[r.code];
          const picked = Object.values(row.sources).filter(Boolean).length;
          const total = r.sources.length;
          const allOn = picked === total;
          const rightLabel = row.expanded
            ? "Hide"
            : picked > 0
              ? `${picked} of ${total}`
              : `${total} source${total === 1 ? "" : "s"}`;

          return (
            <div key={r.code} className="border-b border-ans-line last:border-b-0">
              <div
                className={cn(
                  "flex items-start gap-3.5 px-6 py-3.5",
                  row.expanded && "bg-white"
                )}
              >
                <button
                  type="button"
                  aria-label={`Follow every ${r.code} source`}
                  aria-pressed={allOn}
                  onClick={() => setAll(r.code, !allOn)}
                  className="mt-[3px] cursor-pointer"
                >
                  <CheckBox checked={picked > 0} />
                </button>
                <button
                  type="button"
                  onClick={() => toggleExpanded(r.code)}
                  className="min-w-0 flex-1 cursor-pointer text-left"
                >
                  <span className="block text-[16px] font-bold text-ans-navy">{r.code}</span>
                  <span className="block text-[15px] text-ans-body">
                    {r.subtitle ?? r.name}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => toggleExpanded(r.code)}
                  className="mt-0.5 shrink-0 cursor-pointer text-[14px] text-ans-muted hover:text-ans-navy"
                >
                  {rightLabel}
                </button>
              </div>

              {row.expanded && (
                <div
                  className={cn(
                    "grid gap-x-6 gap-y-3 bg-[#f4f6f7] px-6 py-4 pl-[54px]",
                    columns === 3 ? "sm:grid-cols-3" : "grid-cols-1"
                  )}
                >
                  {r.sources.map((s) => (
                    <label
                      key={s}
                      className="flex cursor-pointer items-center gap-2.5 text-[15px] text-ans-ink select-none"
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        checked={row.sources[s]}
                        onChange={() => toggleSource(r.code, s)}
                      />
                      <CheckBox checked={row.sources[s]} accent="cyan" className="size-[17px]" />
                      <span>{s}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {visible.length === 0 && (
          <p className="px-6 py-6 text-[15px] text-ans-muted">
            No regulator or source matches &ldquo;{query}&rdquo;.
          </p>
        )}
      </div>
    </div>
  );
}
