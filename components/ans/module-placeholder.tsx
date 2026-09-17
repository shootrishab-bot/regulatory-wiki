import Link from "next/link";
import { Panel, SectionHeading } from "@/components/ans/ui";

/**
 * Stands in for the gyaani modules that live on the matter platform and are
 * out of scope for this build. They are in the sidebar because the mockup has
 * them there and the navigation has to feel whole; clicking one should say so
 * plainly rather than 404.
 */
export function ModulePlaceholder({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="max-w-3xl">
      <Panel>
        <SectionHeading>{title}</SectionHeading>
        <div className="px-6 pt-5 pb-6">
          <p className="text-[16.5px] leading-relaxed text-ans-ink">{description}</p>
          <p className="mt-4 text-[16px] leading-relaxed text-ans-body">
            This preview covers Horizon Scan and the regulatory library it draws on.
          </p>
          <div className="mt-6 flex flex-wrap gap-6">
            <Link href="/horizon" className="text-[16px] text-ans-navy hover:underline">
              Go to Horizon Scan
            </Link>
            <Link href="/library" className="text-[16px] text-ans-navy hover:underline">
              Go to the regulatory library
            </Link>
          </div>
        </div>
      </Panel>
    </div>
  );
}
