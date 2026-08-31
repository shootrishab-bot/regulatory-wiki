import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

/**
 * Optimistic, cookie-based gate for /admin/* -- runs before any admin page
 * or Server Action executes, so an unauthenticated/non-ADMIN request never
 * even starts rendering the review queue. This is `proxy.ts`, not
 * `middleware.ts`: this Next.js version (16.2.12) deprecated and renamed the
 * `middleware` file convention to `proxy` (see
 * node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md's
 * own "Migration to Proxy" section) -- per AGENTS.md's warning that this
 * isn't the Next.js training data assumes, that doc was read before writing
 * this file rather than defaulting to the old `middleware.ts` name, which
 * would silently never run under v16.
 *
 * Deliberately does NOT use next-auth v4's own `next-auth/middleware`
 * (`withAuth`) helper -- that helper is coupled to the old `middleware.ts`
 * convention by name/shape and its compatibility with the new `proxy`
 * convention is unverified (next-auth v4.24 predates Next.js 16 by a wide
 * margin). `getToken()` from `next-auth/jwt` has no such coupling: it only
 * needs a NextRequest to read/verify the session cookie, so it works
 * identically regardless of what the enclosing file is named.
 *
 * This is NOT the only auth check -- see lib/require-admin.ts's own
 * docstring. Proxy only does a fast, optimistic check against the JWT
 * cookie; every admin page and the resolveEntryReview Server Action also
 * check the real session server-side, per the Next.js authentication guide's
 * explicit warning that Proxy "should not be your only line of defense."
 */
export default async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // The sign-in page itself must stay reachable, or no one could ever log
  // in. NextAuth's own /api/auth/* routes (session/csrf/callback/etc.) must
  // also stay reachable for the same reason -- signing in IS a request to
  // one of them.
  if (pathname === "/admin/login" || pathname.startsWith("/api/auth")) {
    return NextResponse.next();
  }

  const token = await getToken({ req: request, secret: process.env.NEXTAUTH_SECRET });

  if (!token || token.role !== "ADMIN") {
    const loginUrl = new URL("/admin/login", request.url);
    loginUrl.searchParams.set("from", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
}

// Node.js runtime is the default for Proxy as of Next.js 16 (see the same
// proxy.md's version history), which is what makes getToken() (and bcrypt,
// used only in the Credentials `authorize()` callback, never here) safe to
// rely on -- neither is guaranteed to work under the old Edge default.
export const config = {
  matcher: ["/admin/:path*"],
};
