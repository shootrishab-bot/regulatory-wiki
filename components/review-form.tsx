"use client";

import { useActionState } from "react";
import { resolveEntryReview, type ReviewActionState } from "@/lib/actions";
import type { TagOption } from "@/lib/queries";

const INITIAL: ReviewActionState = { ok: false, message: "" };

/**
 * Correction form for a single flagged entry.
 *
 * Client component because it uses useActionState for the pending/result
 * state. The options passed in are already scoped to this entry's regulator
 * by the server component, and the Server Action re-validates them anyway
 * (a direct POST could send anything).
 */
export function ReviewForm({
  entryId,
  subjects,
  instrumentTypes,
  currentSubjectId,
  currentInstrumentTypeId,
}: {
  entryId: string;
  subjects: TagOption[];
  instrumentTypes: TagOption[];
  currentSubjectId: string | null;
  currentInstrumentTypeId: string | null;
}) {
  const [state, formAction, pending] = useActionState(resolveEntryReview, INITIAL);

  const selectClass =
    "h-9 w-full rounded-md border border-border bg-background px-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring/50";

  return (
    <form action={formAction} className="space-y-3 rounded-lg border border-border p-4">
      <h2 className="text-sm font-medium">Correct and resolve</h2>
      <input type="hidden" name="entryId" value={entryId} />

      <label className="block">
        <span className="mb-1 block text-xs text-muted-foreground">Subject</span>
        <select
          name="subjectId"
          defaultValue={currentSubjectId ?? ""}
          className={selectClass}
          required
        >
          <option value="">Choose a subject...</option>
          {subjects.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.status !== "ACTIVE" ? ` (${t.status.toLowerCase()})` : ""}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="mb-1 block text-xs text-muted-foreground">Instrument type</span>
        <select
          name="instrumentTypeId"
          defaultValue={currentInstrumentTypeId ?? ""}
          className={selectClass}
          required
        >
          <option value="">Choose an instrument type...</option>
          {instrumentTypes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
              {t.status !== "ACTIVE" ? ` (${t.status.toLowerCase()})` : ""}
            </option>
          ))}
        </select>
      </label>

      <button
        type="submit"
        disabled={pending}
        className="h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80 disabled:opacity-50"
      >
        {pending ? "Saving..." : "Save and mark reviewed"}
      </button>

      {state.message && (
        <p
          role="status"
          className={`text-sm ${state.ok ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"}`}
        >
          {state.message}
        </p>
      )}
    </form>
  );
}
