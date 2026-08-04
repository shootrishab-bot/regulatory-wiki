import { Crumbs, PageHeader } from "@/components/page-shell";
import { TagIndex } from "@/components/tag-index";
import { getTagsByFacet } from "@/lib/queries";

// These pages read live Postgres counts and must reflect an admin correction
// immediately, so they are never prerendered at build time.
export const dynamic = "force-dynamic";

export default async function InstrumentsPage() {
  const groups = await getTagsByFacet("INSTRUMENT_TYPE");
  const total = groups.reduce((s, g) => s + g.tags.length, 0);

  return (
    <div>
      <Crumbs items={[{ label: "Instrument types" }]} />
      <PageHeader
        title="Instrument types"
        description={`What kind of document it is - an order, a rules notification, an advisory, a press release. ${total} tags across ${groups.length} regulators.`}
      />
      <TagIndex groups={groups} hrefBase="/instruments" />
    </div>
  );
}
