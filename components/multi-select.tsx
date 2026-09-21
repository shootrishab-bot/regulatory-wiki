"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * A dropdown that takes more than one answer.
 *
 * A native <select multiple> can technically do this, but it renders as an
 * always-open scrolling box and needs ctrl-click to pick a second value,
 * which nobody discovers. This looks like the other selects on the bar,
 * opens a list of checkboxes, and holds the choices until Apply.
 *
 * The chosen values are written out as hidden inputs sharing one name, so a
 * plain GET form submits ?regulator=DOT&regulator=MIB and the server reads
 * them as an array. The surrounding form still needs no JavaScript to
 * submit; only the picking is interactive.
 *
 * Controlled, because the parent has to react to a change here -- picking a
 * domain narrows the regulator list, picking a regulator swaps the subject
 * vocabulary. See components/tag-scoped-selects.tsx.
 */

export interface MultiOption {
  value: string;
  label: string;
  /** Optional heading; consecutive options sharing one are shown under it. */
  group?: string;
}

export function MultiSelect({
  name,
  options,
  values,
  onChange,
  placeholder,
  disabled = false,
  disabledLabel,
  fieldClassName,
  id,
}: {
  name: string;
  options: MultiOption[];
  values: string[];
  onChange: (next: string[]) => void;
  placeholder: string;
  disabled?: boolean;
  disabledLabel?: string;
  fieldClassName: string;
  id?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const root = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const selected = options.filter((o) => values.includes(o.value));
  const summary = disabled
    ? (disabledLabel ?? placeholder)
    : selected.length === 0
      ? placeholder
      : selected.length === 1
        ? selected[0].label
        : `${selected[0].label} +${selected.length - 1}`;

  function toggle(value: string) {
    onChange(values.includes(value) ? values.filter((v) => v !== value) : [...values, value]);
  }

  // Group headings are rendered whenever an option carries one, so a
  // multi-regulator subject list stays visibly separated by regulator rather
  // than reading as one merged vocabulary. Worked out up front rather than
  // by tracking the previous group during the map, which is a reassignment
  // mid-render and something React can legitimately run twice.
  const rows = React.useMemo(
    () =>
      options.map((o, i) => ({
        option: o,
        heading: o.group && o.group !== options[i - 1]?.group ? o.group : null,
      })),
    [options]
  );

  return (
    <div ref={root} className="relative">
      {!disabled &&
        values.map((v) => <input key={v} type="hidden" name={name} value={v} />)}

      <button
        type="button"
        id={id}
        disabled={disabled}
        aria-expanded={open}
        aria-haspopup="listbox"
        onClick={() => setOpen((o) => !o)}
        className={cn(fieldClassName, "flex items-center justify-between gap-2 text-left")}
      >
        <span
          className={cn("truncate", selected.length === 0 && "text-ans-muted")}
          title={selected.length > 1 ? selected.map((o) => o.label).join(", ") : undefined}
        >
          {summary}
        </span>
        <svg viewBox="0 0 12 8" aria-hidden className="w-3 shrink-0">
          <path d="M1 1l5 5 5-5" fill="none" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      </button>

      {open && !disabled && (
        <div
          role="listbox"
          aria-multiselectable
          className="absolute z-30 mt-1 max-h-72 w-full min-w-[240px] overflow-y-auto rounded-[2px] border border-[#c9ccd0] bg-white py-1 shadow-lg"
        >
          {options.length === 0 && (
            <p className="px-3 py-2 text-[13.5px] text-ans-muted">Nothing to choose from.</p>
          )}
          {rows.map(({ option: o, heading }) => {
            return (
              <React.Fragment key={o.value}>
                {heading && (
                  <p className="mt-1 px-3 pt-1.5 pb-1 text-[11px] font-bold tracking-[0.09em] text-ans-muted uppercase">
                    {heading}
                  </p>
                )}
                <label className="flex cursor-pointer items-start gap-2.5 px-3 py-1.5 text-[14px] text-ans-ink hover:bg-ans-tint">
                  <input
                    type="checkbox"
                    checked={values.includes(o.value)}
                    onChange={() => toggle(o.value)}
                    className="mt-[3px] size-[15px] shrink-0 accent-[#004062]"
                  />
                  <span className="leading-snug">{o.label}</span>
                </label>
              </React.Fragment>
            );
          })}
          {values.length > 0 && (
            <div className="mt-1 border-t border-ans-line px-3 pt-2 pb-1">
              <button
                type="button"
                onClick={() => onChange([])}
                className="text-[13.5px] text-ans-navy hover:underline"
              >
                Clear {values.length} selected
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
