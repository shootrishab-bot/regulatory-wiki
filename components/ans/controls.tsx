"use client";

import * as React from "react";
import { CheckBox, RadioDot } from "@/components/ans/ui";
import { cn } from "@/lib/utils";

/**
 * Checkboxes and radios for the ANS surface.
 *
 * They hold their own state and are wired to nothing. That is deliberate:
 * this layer of the product is a working demo of the firm's mockup, so the
 * controls have to *feel* alive when a partner clicks them, but none of the
 * delivery settings, subscriptions or newsletter topics are persisted yet.
 */

export function CheckToggle({
  defaultChecked = false,
  accent = "navy",
  label,
  labelClassName,
  className,
}: {
  defaultChecked?: boolean;
  accent?: "navy" | "cyan";
  label?: React.ReactNode;
  labelClassName?: string;
  className?: string;
}) {
  const [checked, setChecked] = React.useState(defaultChecked);
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-3 select-none", className)}>
      <input
        type="checkbox"
        className="sr-only"
        checked={checked}
        onChange={(e) => setChecked(e.target.checked)}
      />
      <CheckBox checked={checked} accent={accent} />
      {label && <span className={cn("text-[15px] text-ans-ink", labelClassName)}>{label}</span>}
    </label>
  );
}

export interface RadioOption {
  value: string;
  label: string;
  hint?: string;
}

export function RadioList({
  name,
  options,
  defaultValue,
}: {
  name: string;
  options: RadioOption[];
  defaultValue: string;
}) {
  const [value, setValue] = React.useState(defaultValue);
  return (
    <div className="space-y-3.5">
      {options.map((o) => (
        <label key={o.value} className="flex cursor-pointer gap-3 select-none">
          <input
            type="radio"
            name={name}
            className="sr-only"
            checked={value === o.value}
            onChange={() => setValue(o.value)}
          />
          <span className="mt-[3px]">
            <RadioDot checked={value === o.value} />
          </span>
          <span className="min-w-0">
            <span className="block text-[15px] text-ans-ink">{o.label}</span>
            {o.hint && <span className="block text-[14px] text-ans-muted">{o.hint}</span>}
          </span>
        </label>
      ))}
    </div>
  );
}
