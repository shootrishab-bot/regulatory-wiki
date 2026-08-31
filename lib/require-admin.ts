import "server-only";
import { getServerSession } from "next-auth/next";
import { redirect } from "next/navigation";
import { authOptions } from "./auth";

/**
 * Data Access Layer-style session check (Next.js's own recommended pattern
 * for App Router auth -- see the "Creating a Data Access Layer" section of
 * its authentication guide). `proxy.ts` at the repo root already redirects
 * unauthenticated/non-ADMIN requests away from /admin/* before rendering
 * starts, but per that same guide, Proxy "should not be your only line of
 * defense" -- it only does an optimistic, cookie-based check. This is the
 * real, server-side check: called from both admin page components AND from
 * lib/actions.ts's resolveEntryReview Server Action, since a Server Action
 * is reachable by direct POST regardless of what the UI renders and needs
 * its own authorization check, not just the page's.
 */
export async function requireAdminSession() {
  const session = await getAdminSession();

  if (!session) {
    redirect("/admin/login");
  }

  return session;
}

/**
 * Non-redirecting variant for Server Actions (lib/actions.ts's
 * resolveEntryReview): a redirect thrown mid-mutation doesn't fit that
 * function's `ReviewActionState` return contract the way it does for a page
 * component. Callers decide how to fail -- typically returning
 * `{ ok: false, message: "..." }` rather than navigating the browser away
 * from a form the user was actively filling in.
 */
export async function getAdminSession() {
  const session = await getServerSession(authOptions);
  if (!session?.user || session.user.role !== "ADMIN") {
    return null;
  }
  return session;
}
