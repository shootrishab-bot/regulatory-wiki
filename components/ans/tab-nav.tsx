"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export interface Tab {
  href: string;
  label: string;
  /** Renders as "History &middot; 6". */
  count?: number;
  /** Leaves Horizon Scan entirely -- shown with a quiet arrow. */
  external?: boolean;
}

export function TabNav({ tabs }: { tabs: Tab[] }) {
  const pathname = usePathname() ?? "";

  return (
    <nav className="flex gap-8 overflow-x-auto px-8">
      {tabs.map((tab) => {
        const active = !tab.external && pathname === tab.href;
        return (
          <Link
            key={tab.href}
            href={tab.href}
            className={cn(
              "-mb-px border-b-[3px] pt-1 pb-3 text-[17px] whitespace-nowrap transition-colors",
              active
                ? "border-ans-navy font-bold text-ans-navy"
                : "border-transparent text-ans-body hover:text-ans-navy"
            )}
          >
            {tab.label}
            {typeof tab.count === "number" && (
              <span className="text-ans-muted"> &middot; {tab.count}</span>
            )}
            {tab.external && <span aria-hidden className="ml-1.5 text-ans-muted">&rarr;</span>}
          </Link>
        );
      })}
    </nav>
  );
}
