import { Crumbs, PageHeader } from "@/components/page-shell";
import { TagIndex } from "@/components/tag-index";
import { getTagsByFacet } from "@/lib/queries";

// These pages read live Postgres counts and must reflect an admin correction
// immediately, so they are never prerendered at build time.
export const dynamic = "force-dynamic";

export default async function SubjectsPage() {
  const groups = await getTagsByFacet("SUBJECT");
  const total = groups.reduce((s, g) => s + g.tags.length, 0);

  return (
    <div>
      <Crumbs items={[{ label: "Subjects" }]} />
      <PageHeader
        title="Subjects"
        description={`What a document is about. ${total} subject tags across ${groups.length} regulators, grouped by regulator because each vocabulary was built for that regulator alone.`}
      />
      <TagIndex groups={groups} hrefBase="/subjects" />
    </div>
  );
}
