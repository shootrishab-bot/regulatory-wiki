"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { CURRENT_USER, FIRM, LAST_REFRESHED } from "@/lib/ans/demo-data";
import { cn } from "@/lib/utils";

/**
 * The gyaani chrome: fixed sidebar on the left, everything else to the right
 * of it. Every route in the app now renders inside this, including the
 * regulatory wiki pages that predate it, so the two halves of the product
 * read as one platform rather than two bolted together.
 *
 * Client component only because it needs usePathname() for the active nav
 * item and to decide whether a route brings its own header (/horizon does;
 * the wiki pages do not). `children` is still rendered on the server and
 * passed straight through, so no page pays for this.
 */

const BRAND = { mark: "g", name: "gyaani" };

interface NavItem {
  href: string;
  label: string;
  badge?: string;
  /** Matches nested routes too, e.g. /documents/[id] under the library. */
  match?: string[];
}

const NAV: { section: string; items: NavItem[] }[] = [
  {
    section: "Overview",
    items: [
      { href: "/", label: "Dashboard" },
      { href: "/approvals", label: "Approvals" },
    ],
  },
  {
    section: "BD & Knowledge",
    items: [
      { href: "/credentials", label: "Credentials" },
      { href: "/pitch-generator", label: "Pitch Generator" },
      { href: "/meetings", label: "Meetings & Travel" },
      { href: "/partner-profiles", label: "Partner Profiles" },
      { href: "/practice-profiles", label: "Practice Profiles" },
      { href: "/horizon", label: "Horizon Scan", badge: "NEW" },
      {
        href: "/library",
        label: "Regulatory library",
        match: ["/library", "/documents", "/regulators", "/domains", "/subjects", "/instruments", "/admin"],
      },
    ],
  },
  {
    section: "Help",
    items: [
      { href: "/user-guide", label: "User Guide" },
      { href: "/help", label: "Help content" },
    ],
  },
];

/** Titles for routes that do not supply their own header. */
const TITLES: { prefix: string; title: string; search?: boolean }[] = [
  { prefix: "/approvals", title: "Approvals" },
  { prefix: "/credentials", title: "Credentials" },
  { prefix: "/pitch-generator", title: "Pitch Generator" },
  { prefix: "/meetings", title: "Meetings & Travel" },
  { prefix: "/partner-profiles", title: "Partner Profiles" },
  { prefix: "/practice-profiles", title: "Practice Profiles" },
  { prefix: "/user-guide", title: "User Guide" },
  { prefix: "/help", title: "Help content" },
  { prefix: "/admin", title: "Regulatory library" },
  { prefix: "/library", title: "Regulatory library", search: true },
  { prefix: "/documents", title: "Regulatory library", search: true },
  { prefix: "/regulators", title: "Regulatory library", search: true },
  { prefix: "/domains", title: "Regulatory library", search: true },
  { prefix: "/subjects", title: "Regulatory library", search: true },
  { prefix: "/instruments", title: "Regulatory library", search: true },
];

function isActive(pathname: string, item: NavItem) {
  const prefixes = item.match ?? [item.href];
  return prefixes.some((p) =>
    p === "/" ? pathname === "/" : pathname === p || pathname.startsWith(`${p}/`)
  );
}

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname() ?? "/";
  const ownsHeader = pathname === "/" || pathname.startsWith("/horizon");
  const route = TITLES.find(
    (t) => pathname === t.prefix || pathname.startsWith(`${t.prefix}/`)
  );

  return (
    <div className="flex min-h-screen bg-ans-canvas">
      <aside className="sticky top-0 hidden h-screen w-[272px] shrink-0 flex-col border-r border-ans-line bg-white lg:flex">
        <Link href="/" className="flex items-center gap-3 border-b border-ans-line px-6 py-5">
          <span className="flex size-9 items-center justify-center rounded-full border-2 border-ans-cyan text-[19px] leading-none font-bold text-ans-navy">
            {BRAND.mark}
          </span>
          <span className="text-[26px] leading-none font-normal tracking-tight text-ans-ink">
            {BRAND.name}
          </span>
        </Link>

        <nav className="flex-1 overflow-y-auto py-6">
          {NAV.map((group) => (
            <div key={group.section} className="mb-7">
              <p className="px-6 pb-2 text-[12px] font-bold tracking-[0.12em] text-ans-orange uppercase">
                {group.section}
              </p>
              {group.items.map((item) => {
                const active = isActive(pathname, item);
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    className={cn(
                      "flex items-center justify-between gap-2 border-l-4 py-2.5 pr-4 pl-5 text-[16px] transition-colors",
                      active
                        ? "border-ans-navy bg-ans-nav font-semibold text-ans-ink"
                        : "border-transparent text-ans-ink hover:bg-ans-tint"
                    )}
                  >
                    <span>{item.label}</span>
                    {item.badge && (
                      <span className="rounded-[2px] bg-ans-cyan px-1.5 py-0.5 text-[11px] font-bold tracking-[0.08em] text-white uppercase">
                        {item.badge}
                      </span>
                    )}
                  </Link>
                );
              })}
            </div>
          ))}
        </nav>

        <div className="flex items-center gap-3 border-t border-ans-line px-6 py-4">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-ans-navy text-[14px] font-bold text-white">
            {CURRENT_USER.initials}
          </span>
          <span className="min-w-0">
            <span className="block truncate text-[15px] font-semibold text-ans-ink">
              {CURRENT_USER.name}
            </span>
            <span className="block truncate text-[13px] text-ans-muted">
              {CURRENT_USER.role} &middot; {CURRENT_USER.team}
            </span>
          </span>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        {!ownsHeader && (
          <AnsHeader title={route?.title ?? BRAND.name} search={route?.search} />
        )}
        {/* Routes that own their header also own their padding (they run
            edge-to-edge card grids). Everything else keeps the wiki's
            centred, 6xl measure, so those pages needed no edits at all. */}
        <main className={ownsHeader ? "flex-1" : "mx-auto w-full max-w-6xl flex-1 px-8 py-8"}>
          {children}
        </main>
      </div>
    </div>
  );
}

/**
 * The page header from the mockup: title on the left, index freshness and the
 * client group block on the right. /horizon renders its own (with the tab
 * strip underneath); everything else gets this one from the shell.
 */
export function AnsHeader({
  title,
  beta,
  search,
  children,
}: {
  title: string;
  beta?: boolean;
  search?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <header className="border-b border-ans-line bg-white">
      <div className="flex flex-wrap items-center justify-between gap-4 px-8 pt-6 pb-5">
        <div className="flex items-center gap-3">
          <h1 className="text-[30px] leading-none font-normal text-ans-navy">{title}</h1>
          {beta && (
            <span className="rounded-[2px] border border-ans-cyan px-2 py-[3px] text-[11.5px] font-bold tracking-[0.1em] text-ans-cyan uppercase">
              Beta
            </span>
          )}
        </div>
        <div className="flex items-center gap-8">
          {search && (
            <form action="/documents" method="get" className="hidden md:block">
              <input
                type="search"
                name="q"
                placeholder="Search the regulatory index"
                aria-label="Search the regulatory index"
                className="w-64 rounded-[2px] border border-[#c9ccd0] px-3 py-2 text-[14px] outline-none focus:border-ans-navy"
              />
            </form>
          )}
          <p className="hidden text-[14px] text-ans-body sm:block">
            Regulatory index last refreshed {LAST_REFRESHED}
          </p>
          <div className="text-right leading-tight">
            <p className="text-[20px] font-bold tracking-wide text-ans-navy">{FIRM.code}</p>
            <p className="text-[11px] text-ans-muted">{FIRM.name}</p>
          </div>
        </div>
      </div>
      {children}
    </header>
  );
}
