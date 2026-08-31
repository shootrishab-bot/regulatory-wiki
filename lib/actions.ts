"use server";

/**
 * Server Actions for the admin review UI.
 *
 * AUTH: resolveEntryReview now checks for a real ADMIN session itself, via
 * getAdminSession() (lib/require-admin.ts) -- not just relying on the page
 * that renders its form. Server Actions are reachable by direct POST
 * regardless of what the UI renders (see the Next.js "Mutating Data" guide's
 * own warning), so the check has to live here, not only in
 * app/admin/review/[id]/page.tsx. Returns the same ReviewActionState shape
 * the form already expects on failure, rather than redirecting mid-mutation.
 */

import { revalidatePath } from "next/cache";
import { Facet } from "@/app/generated/prisma/enums";
import { prisma } from "./prisma";
import { withDbRetry } from "./db-retry";
import { getAdminSession } from "./require-admin";

export interface ReviewActionState {
  ok: boolean;
  message: string;
}

/**
 * Applies a human correction to a flagged entry and clears its review flag.
 *
 * Validates that the chosen tags really belong to THIS entry's regulator and
 * facet before writing -- the form only offers valid options, but a Server
 * Action can be POSTed directly with any ids, so the check happens here
 * rather than being assumed from the UI.
 */
export async function resolveEntryReview(
  _prevState: ReviewActionState,
  formData: FormData
): Promise<ReviewActionState> {
  const session = await getAdminSession();
  if (!session) {
    return { ok: false, message: "You must be signed in as an admin to do this." };
  }

  const entryId = String(formData.get("entryId") ?? "");
  const subjectId = String(formData.get("subjectId") ?? "");
  const instrumentTypeId = String(formData.get("instrumentTypeId") ?? "");

  if (!entryId) {
    return { ok: false, message: "Missing entry id." };
  }

  const entry = await withDbRetry(
    () =>
      prisma.updateEntry.findUnique({
        where: { id: entryId },
        select: {
          id: true,
          sourceDocument: { select: { regulatorId: true } },
        },
      }),
    "resolveEntryReview lookup"
  );

  if (!entry) {
    return { ok: false, message: "Entry not found." };
  }

  const regulatorId = entry.sourceDocument.regulatorId;

  // Both tags are required to resolve a review: clearing the flag while
  // leaving a tag unset would put an untagged row onto the public site,
  // which is worse than leaving it flagged.
  if (!subjectId || !instrumentTypeId) {
    return {
      ok: false,
      message: "Both a Subject and an Instrument Type must be chosen before marking reviewed.",
    };
  }

  const tags = await withDbRetry(
    () =>
      prisma.taxonomyTag.findMany({
        where: { id: { in: [subjectId, instrumentTypeId] }, regulatorId },
        select: { id: true, facet: true },
      }),
    "resolveEntryReview tag validation"
  );

  const subjectTag = tags.find((t) => t.id === subjectId && t.facet === Facet.SUBJECT);
  const instrumentTag = tags.find(
    (t) => t.id === instrumentTypeId && t.facet === Facet.INSTRUMENT_TYPE
  );

  if (!subjectTag) {
    return { ok: false, message: "Chosen Subject is not a valid tag for this regulator." };
  }
  if (!instrumentTag) {
    return {
      ok: false,
      message: "Chosen Instrument Type is not a valid tag for this regulator.",
    };
  }

  await withDbRetry(
    () =>
      prisma.updateEntry.update({
        where: { id: entryId },
        data: {
          subjectId,
          instrumentTypeId,
          needsReview: false,
          reviewReasons: [],
          // Overwrites the model's own audit string so the row does not
          // keep claiming a machine classification it no longer has. The
          // original model attribution is intentionally replaced, not
          // appended to -- after a human correction the tags ARE the
          // human's.
          classifiedBy: "human_review",
          classificationReason: "Corrected and confirmed via admin review.",
        },
      }),
    "resolveEntryReview update"
  );

  // Both surfaces change: the entry leaves the admin queue and enters the
  // public browse list.
  revalidatePath("/admin/review");
  revalidatePath(`/admin/review/${entryId}`);
  revalidatePath("/");
  revalidatePath(`/documents/${entryId}`);

  return { ok: true, message: "Saved. This entry is now published and has left the review queue." };
}
