import { TagDetail } from "@/components/tag-detail";

type Params = Promise<{ id: string }>;
type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function one(v: string | string[] | undefined): string | undefined {
  const s = Array.isArray(v) ? v[0] : v;
  return s && s.trim() ? s : undefined;
}

export default async function SubjectDetailPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const { id } = await params;
  const sp = await searchParams;
  return (
    <TagDetail
      id={id}
      facet="SUBJECT"
      page={Number(one(sp.page) ?? "1") || 1}
      sort={one(sp.sort)}
    />
  );
}
