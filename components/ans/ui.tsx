import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * Presentational primitives for the ANS / Horizon Scan surface.
 *
 * These deliberately sit alongside components/ui (shadcn + base-ui) rather
 * than replacing it: the firm's mockup is a much flatter, squarer, more
 * print-like system than shadcn's defaults (1px hairlines, 2px radius, a red
 * rule under every section label), and bending the shadcn variants that far
 * would have made them useless for the wiki pages that already depend on
 * them. The wiki keeps components/ui; the ANS shell uses these.
 */

export function Panel({
  className,
  children,
  ...props
}: React.ComponentProps<"section">) {
  return (
    <section
      className={cn("rounded-[2px] border border-ans-line bg-white", className)}
      {...props}
    >
      {children}
    </section>
  );
}

/**
 * The label + red rule that opens every card in the mockup. `sub` is the
 * optional line that sits between the label and the rule (used by
 * "1 - REGULATORS & SOURCES", whose source count sits above the rule).
 */
export function SectionHeading({
  children,
  sub,
  subPosition = "below",
  action,
  className,
}: {
  children: React.ReactNode;
  sub?: React.ReactNode;
  /** The mockup puts the source count above the rule, prose below it. */
  subPosition?: "above" | "below";
  action?: React.ReactNode;
  className?: string;
}) {
  const subLine = sub ? (
    <p className={cn("text-[15px] leading-relaxed text-ans-body", subPosition === "above" ? "mt-2" : "mt-3")}>
      {sub}
    </p>
  ) : null;

  return (
    <div className={cn("px-6 pt-5", className)}>
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h2 className="text-[12.5px] font-bold tracking-[0.11em] text-ans-navy uppercase">
            {children}
          </h2>
          {subPosition === "above" && subLine}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div className="mt-2 h-px w-[62%] max-w-[640px] bg-ans-red" />
      {subPosition === "below" && subLine}
    </div>
  );
}

export type Level = "red" | "amber" | "green" | "info";

const DOT: Record<Level, string> = {
  red: "bg-ans-red",
  amber: "bg-ans-orange",
  green: "bg-ans-green",
  info: "bg-ans-cyan",
};

export function Dot({ level, className }: { level: Level; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn("mt-[7px] block size-[9px] shrink-0 rounded-full", DOT[level], className)}
    />
  );
}

const LEVEL_TEXT: Record<Level, string> = {
  red: "text-ans-red",
  amber: "text-ans-amber",
  green: "text-ans-green",
  info: "text-ans-cyan",
};

export function LevelLabel({ level, children }: { level: Level; children?: React.ReactNode }) {
  return (
    <span
      className={cn(
        "text-[11.5px] font-bold tracking-[0.09em] uppercase",
        LEVEL_TEXT[level]
      )}
    >
      {children ?? level}
    </span>
  );
}

/** Tick glyph shared by the static and the interactive checkbox. */
export function TickIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={cn("size-[13px]", className)} aria-hidden>
      <path
        d="M2.5 8.5l3.4 3.4L13.5 4.3"
        fill="none"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="square"
      />
    </svg>
  );
}

export function CheckBox({
  checked,
  accent = "navy",
  className,
}: {
  checked: boolean;
  accent?: "navy" | "cyan";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex size-[19px] shrink-0 items-center justify-center rounded-[2px] border",
        checked
          ? accent === "cyan"
            ? "border-ans-cyan bg-ans-cyan text-white"
            : "border-ans-navy bg-ans-navy text-white"
          : "border-[#b9bdc1] bg-white text-transparent",
        className
      )}
    >
      {checked && <TickIcon />}
    </span>
  );
}

export function RadioDot({ checked }: { checked: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex size-[17px] shrink-0 items-center justify-center rounded-full border",
        checked ? "border-ans-navy" : "border-[#b9bdc1]"
      )}
    >
      {checked && <span className="size-[9px] rounded-full bg-ans-navy" />}
    </span>
  );
}

type ChipTone = "grey" | "navy" | "green" | "amber" | "cyan";

const CHIP: Record<ChipTone, string> = {
  grey: "border-transparent bg-[#f1f2f3] text-ans-ink",
  navy: "border-ans-navy text-ans-navy",
  green: "border-ans-green text-ans-green",
  amber: "border-ans-amber text-ans-amber",
  cyan: "border-ans-cyan text-ans-cyan",
};

export function Chip({
  tone = "grey",
  className,
  children,
}: {
  tone?: ChipTone;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-[2px] border px-2.5 py-[5px] text-[13px] leading-none",
        CHIP[tone],
        className
      )}
    >
      {children}
    </span>
  );
}

/** Small uppercase status chip: PRIMARY, CONSENTED, CONSENT PENDING. */
export function StatusChip({
  tone,
  children,
}: {
  tone: ChipTone;
  children: React.ReactNode;
}) {
  return (
    <Chip tone={tone} className="px-2 py-[3px] text-[11px] font-semibold tracking-[0.08em] uppercase">
      {children}
    </Chip>
  );
}

const BTN =
  "inline-flex items-center justify-center rounded-[2px] px-5 py-2.5 text-[15px] font-bold whitespace-nowrap transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ans-navy";

export const ansButton = {
  primary: cn(BTN, "bg-ans-navy text-white hover:bg-[#00537f]"),
  outline: cn(BTN, "border border-ans-line bg-white text-ans-ink hover:bg-ans-tint"),
} as const;

export function TextField({
  className,
  ...props
}: React.ComponentProps<"input">) {
  return (
    <input
      className={cn(
        "w-full rounded-[2px] border border-[#c9ccd0] bg-white px-3.5 py-2.5 text-[15px] text-ans-ink outline-none placeholder:text-ans-muted focus:border-ans-navy",
        className
      )}
      {...props}
    />
  );
}

/**
 * Native <select> under a drawn chevron. The arrow is a sibling element
 * rather than a background image so it survives class merging and keeps the
 * same stroke weight as the rest of the mockup's iconography.
 */
export function SelectField({
  className,
  ...props
}: React.ComponentProps<"select">) {
  return (
    <span className={cn("relative block", className)}>
      <select
        className="w-full appearance-none rounded-[2px] border border-[#c9ccd0] bg-white py-2.5 pr-10 pl-3.5 text-[15px] text-ans-ink outline-none focus:border-ans-navy"
        {...props}
      />
      <svg
        viewBox="0 0 12 8"
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-3.5 w-3 -translate-y-1/2"
      >
        <path d="M1 1l5 5 5-5" fill="none" stroke="#33383d" strokeWidth="1.6" />
      </svg>
    </span>
  );
}

/** The quiet field caption used above inputs ("Frequency", "Also deliver to"). */
export function FieldLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <p className={cn("text-[15px] text-ans-body", className)}>{children}</p>;
}
