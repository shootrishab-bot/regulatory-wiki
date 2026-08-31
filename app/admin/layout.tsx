import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { SignOutButton } from "@/components/sign-out-button";

/**
 * Thin, presentational-only wrapper for every /admin/* route (including
 * /admin/login itself, where there's no session yet, so the bar below
 * simply doesn't render). Does NOT perform the auth redirect -- proxy.ts
 * already does that before this layout would even run, and each protected
 * page additionally calls requireAdminSession() itself (see that function's
 * own docstring for why a layout-level check alone isn't relied on: Next.js's
 * authentication guide warns layouts don't re-run on client-side
 * navigations between sibling routes the way a fresh page load does).
 */
export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const session = await getServerSession(authOptions);

  return (
    <div className="space-y-4">
      {session?.user && (
        <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 px-3 py-2 text-sm text-muted-foreground">
          <span>
            Signed in as <span className="text-foreground">{session.user.email}</span>
          </span>
          <SignOutButton />
        </div>
      )}
      {children}
    </div>
  );
}
