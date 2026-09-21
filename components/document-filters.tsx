import Link from "next/link";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { TagScopedSelects } from "@/components/tag-scoped-selects";
import { SORT_OPTIONS, type RegulatorTagOptions } from "@/lib/queries";

/**
 * The filter bar for every document list.
 *
 * Still a plain GET <form>, not a client component: it works with no
 * JavaScript, the URL stays shareable and back-button-correct, and the
 * server component re-renders straight from searchParams. Native
 * <select>/<input> rather than the shadcn Select, which is a client listbox
 * and will not submit inside a no-JS form.
 *
 * Three things changed for the associate, all of them about knowing where
 * you are rather than about what can be filtered:
 *
 *   - Every control is labelled. The previous version was seven bare
 *     controls in one row, and the two date inputs in particular were
 *     unreadable without clicking them.
 *   - Date PRESETS. "Anything in the last 30 days" is the single most common
 *     thing to ask this index, and it previously took two date pickers and
 *     arithmetic. They are links, not fields, because they set the URL
 *     directly -- so the page builds them and passes them in.
 *   - The active filters are spelled out underneath in words, each removable
 *     on its own. "Clear (4)" told you how many filters were on but never
 *     which, so a surprising result set had no explanation on screen.
 *
 * Subject and Instrument Type selects stay disabled until a regulator is
 * chosen. Those vocabularies are per-regulator and not comparable across
 * regulators, so one combined list would invite false equivalence -- which
 * is exactly what the dedicated /subjects and /instruments pages avoid. The
 * disabled state now says why in the option text itself rather than only in
 * a title attribute nobody hovers.
 */

export interface FilterPreset {
  label: string;
  href: string;
  active: boolean;
}

export interface ActiveFilter {
  /** e.g. "Regulator" */
  facet: string;
  /** e.g. "RBI" */
  value: string;
  /** URL with this one filter dropped. */
  removeHref: string;
}

const FIELD =
  "h-9 w-full min-w-0 rounded-[2px] border border-[#c9ccd0] bg-white px-2.5 text-[14.5px] text-ans-ink outline-none focus:border-ans-navy disabled:bg-[#f4f5f6] disabled:text-ans-muted";

const LABEL = "mb-1 block text-[11.5px] font-bold tracking-[0.09em] text-ans-muted uppercase";

export function DocumentFilters({
  action,
  domains,
  tagsByRegulator,
  current,
  presets = [],
  activeFilters = [],
}: {
  action: string;
  domains: { id: string; name: string; regulators: { code: string; name: string }[] }[];
  tagsByRegulator: Record<string, RegulatorTagOptions>;
  current: {
    domain?: string | string[];
    regulator?: string | string[];
    subject?: string | string[];
    instrument?: string | string[];
    from?: string;
    to?: string;
    q?: string;
    sort?: string;
  };
  presets?: FilterPreset[];
  activeFilters?: ActiveFilter[];
}) {
  return (
    <div className="rounded-[2px] border border-ans-line bg-white">
      <form action={action} method="get" className="p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[240px] flex-[3_1_280px]">
            <label htmlFor="filter-q" className={LABEL}>
              Search titles
            </label>
            <div className="relative">
              <Search
                className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ans-muted"
                aria-hidden
              />
              <input
                id="filter-q"
                type="search"
                name="q"
                defaultValue={current.q ?? ""}
                placeholder="e.g. consent notice, uplinking, master direction"
                className={cn(FIELD, "pl-9")}
              />
            </div>
          </div>

          <TagScopedSelects
            domains={domains}
            tagsByRegulator={tagsByRegulator}
            current={current}
            fieldClassName={FIELD}
            labelClassName={LABEL}
          />

          <div className="flex-1 basis-[230px]">
            <span className={LABEL}>Published between</span>
            <div className="flex items-center gap-1.5">
              <input
                type="date"
                name="from"
                aria-label="Published from"
                defaultValue={current.from ?? ""}
                className={FIELD}
              />
              <span className="text-[13px] text-ans-muted">to</span>
              <input
                type="date"
                name="to"
                aria-label="Published to"
                defaultValue={current.to ?? ""}
                className={FIELD}
              />
            </div>
          </div>

          <div className="flex-1 basis-[140px]">
            <label htmlFor="filter-sort" className={LABEL}>
              Sort
            </label>
            <select
              id="filter-sort"
              name="sort"
              defaultValue={current.sort ?? "newest"}
              className={FIELD}
            >
              {Object.entries(SORT_OPTIONS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </div>

          <button
            type="submit"
            className="h-9 shrink-0 rounded-[2px] bg-ans-navy px-6 text-[14.5px] font-bold text-white transition-colors hover:bg-[#00537f]"
          >
            Apply
          </button>
        </div>
      </form>

      {presets.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-ans-line px-4 py-3">
          <span className="mr-1 text-[13px] text-ans-muted">Quick range</span>
          {presets.map((p) => (
            <Link
              key={p.label}
              href={p.href}
              className={cn(
                "rounded-[2px] border px-3 py-1.5 text-[13.5px] transition-colors",
                p.active
                  ? "border-ans-navy bg-ans-navy font-semibold text-white"
                  : "border-ans-line text-ans-ink hover:bg-ans-tint"
              )}
            >
              {p.label}
            </Link>
          ))}
        </div>
      )}

      {activeFilters.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-t border-ans-line bg-ans-tint px-4 py-3">
          <span className="mr-1 text-[13px] text-ans-muted">Filtering on</span>
          {activeFilters.map((f) => (
            <Link
              key={`${f.facet}-${f.value}`}
              href={f.removeHref}
              title={`Remove the ${f.facet.toLowerCase()} filter`}
              className="inline-flex items-center gap-2 rounded-[2px] border border-ans-line bg-white px-3 py-1.5 text-[13.5px] text-ans-ink transition-colors hover:border-ans-red hover:text-ans-red"
            >
              <span className="text-ans-muted">{f.facet}:</span>
              <span className="font-semibold">{f.value}</span>
              <span aria-hidden className="text-ans-muted">
                &times;
              </span>
            </Link>
          ))}
          <Link
            href={action}
            className="ml-1 text-[13.5px] text-ans-navy hover:underline"
          >
            Clear all
          </Link>
        </div>
      )}
    </div>
  );
}
