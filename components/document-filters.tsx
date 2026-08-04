import Link from "next/link";
import { Search } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { SORT_OPTIONS, type TagOption } from "@/lib/queries";

/**
 * Dense single-row filter bar.
 *
 * A plain GET <form>, not a client component: it works with no JavaScript,
 * the URL stays shareable and back-button-correct, and the server component
 * re-renders straight from searchParams.
 *
 * Subject and Instrument Type selects appear ONLY once a regulator is
 * chosen. Those vocabularies are per-regulator and not comparable across
 * regulators, so one combined list would invite false equivalence -- which is
 * exactly what the dedicated /subjects and /instruments pages exist to avoid.
 */
export function DocumentFilters({
  action,
  regulators,
  subjects,
  instrumentTypes,
  current,
}: {
  action: string;
  regulators: { code: string; name: string }[];
  subjects: TagOption[];
  instrumentTypes: TagOption[];
  current: {
    regulator?: string;
    subject?: string;
    instrument?: string;
    from?: string;
    to?: string;
    q?: string;
    sort?: string;
  };
}) {
  const scoped = Boolean(current.regulator);

  // Native <select>/<input> rather than the shadcn Select: that one is a
  // client listbox and will not submit inside a no-JS GET form. Styled to
  // match the shadcn control surface.
  const field =
    "h-9 w-full min-w-0 rounded-md border bg-transparent px-2.5 text-sm shadow-xs outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50";

  const active =
    [current.q, current.regulator, current.subject, current.instrument, current.from, current.to]
      .filter(Boolean).length;

  return (
    <form action={action} method="get" className="rounded-xl border bg-muted/20 p-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[190px] flex-[2_1_220px]">
          <Search
            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <input
            type="search"
            name="q"
            aria-label="Quick search titles"
            defaultValue={current.q ?? ""}
            placeholder="Quick search..."
            className={`${field} pl-8`}
          />
        </div>

        <select
          name="regulator"
          aria-label="Regulator"
          defaultValue={current.regulator ?? ""}
          className={`${field} flex-1 basis-[130px]`}
        >
          <option value="">All regulators</option>
          {regulators.map((r) => (
            <option key={r.code} value={r.code}>
              {r.code}
            </option>
          ))}
        </select>

        <select
          name="subject"
          aria-label="Subject"
          defaultValue={current.subject ?? ""}
          disabled={!scoped}
          title={scoped ? undefined : "Choose a regulator first - subjects are per-regulator"}
          className={`${field} flex-[2_1_170px] disabled:opacity-50`}
        >
          <option value="">{scoped ? "All subjects" : "Subject (pick regulator)"}</option>
          {subjects.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>

        <select
          name="instrument"
          aria-label="Instrument type"
          defaultValue={current.instrument ?? ""}
          disabled={!scoped}
          title={scoped ? undefined : "Choose a regulator first - instrument types are per-regulator"}
          className={`${field} flex-[2_1_170px] disabled:opacity-50`}
        >
          <option value="">{scoped ? "All instrument types" : "Instrument (pick regulator)"}</option>
          {instrumentTypes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>

        <div className="flex flex-1 basis-[210px] items-center gap-1.5">
          <input
            type="date"
            name="from"
            aria-label="Published from"
            defaultValue={current.from ?? ""}
            className={field}
          />
          <span className="text-xs text-muted-foreground">to</span>
          <input
            type="date"
            name="to"
            aria-label="Published to"
            defaultValue={current.to ?? ""}
            className={field}
          />
        </div>

        <select
          name="sort"
          aria-label="Sort by"
          defaultValue={current.sort ?? "newest"}
          className={`${field} flex-1 basis-[130px]`}
        >
          {Object.entries(SORT_OPTIONS).map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>

        <button type="submit" className={buttonVariants({ size: "default" })}>
          Apply
        </button>
        {active > 0 && (
          <Link
            href={action}
            className={buttonVariants({ variant: "ghost", size: "default" })}
          >
            Clear ({active})
          </Link>
        )}
      </div>
    </form>
  );
}
