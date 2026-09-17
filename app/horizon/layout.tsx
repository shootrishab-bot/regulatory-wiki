import { AnsHeader } from "@/components/ans/app-shell";
import { TabNav, type Tab } from "@/components/ans/tab-nav";
import { HISTORY } from "@/lib/ans/demo-data";

/**
 * Horizon Scan owns its own header because of the tab strip underneath it;
 * the shell's generic header is suppressed for /horizon/* for that reason.
 *
 * "Regulatory library" is the seam between the two halves of the product:
 * the first three tabs are the new matter-aware layer, and that tab hands
 * over to the regulatory wiki -- the scraped, tagged, reviewed corpus this
 * repo already served -- with its own pages and filters intact.
 */
const TABS: Tab[] = [
  { href: "/horizon", label: "Alerts" },
  { href: "/horizon/newsletters", label: "Newsletters" },
  { href: "/horizon/matter-scanning", label: "Matter scanning" },
  { href: "/library", label: "Regulatory library", external: true },
  { href: "/horizon/history", label: "History", count: HISTORY.length },
];

export default function HorizonLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <AnsHeader title="Horizon Scan" beta>
        <TabNav tabs={TABS} />
      </AnsHeader>
      <div className="px-8 py-7">{children}</div>
    </>
  );
}
