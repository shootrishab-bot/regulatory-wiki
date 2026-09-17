import Link from "next/link";
import { notFound } from "next/navigation";
import { Dot, LevelLabel, Panel, SectionHeading, ansButton } from "@/components/ans/ui";
import { DRAFTS, MATTER_QUEUE } from "@/lib/ans/demo-data";
import { cn } from "@/lib/utils";

type Params = Promise<{ id: string }>;

export function generateStaticParams() {
  return Object.keys(DRAFTS).map((id) => ({ id }));
}

export async function generateMetadata({ params }: { params: Params }) {
  const { id } = await params;
  const draft = DRAFTS[id];
  return { title: draft ? `${draft.client} · draft` : "Draft" };
}

/**
 * The AI draft an associate reviews before it goes to the client. This is the
 * point of the whole layer: a regulator publishes something, the matter file
 * says the client relied on the old position, and the email that closes that
 * gap is already written and waiting.
 *
 * Nothing sends. "Send to client" and "Send to partner" are deliberately
 * inert in this build -- the approval path belongs to the matter platform.
 */
export default async function DraftPage({ params }: { params: Params }) {
  const { id } = await params;
  const draft = DRAFTS[id];
  if (!draft) notFound();

  const queued = MATTER_QUEUE.find((m) => m.id === id);

  return (
    <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,9fr)_minmax(0,4fr)]">
      <div className="space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Link href="/horizon/matter-scanning" className="text-[16px] text-ans-navy hover:underline">
            &larr; Back to matter scanning
          </Link>
          <p className="text-[14px] text-ans-muted">{draft.generated}</p>
        </div>

        <Panel>
          <SectionHeading
            sub={`${draft.client} — ${draft.matter} · ${draft.ref} · Partner: ${draft.partner}`}
            action={
              <div className="flex flex-wrap gap-3">
                <button type="button" className={cn(ansButton.outline, "cursor-pointer")}>
                  Edit draft
                </button>
                <button type="button" className={cn(ansButton.primary, "cursor-pointer")}>
                  Send to partner
                </button>
              </div>
            }
          >
            Draft client email
          </SectionHeading>

          <div className="px-6 pt-5 pb-6">
            <dl className="border border-ans-line">
              <div className="flex gap-4 border-b border-ans-line px-5 py-3">
                <dt className="w-16 shrink-0 text-[13px] font-bold tracking-[0.1em] text-ans-muted uppercase">
                  To
                </dt>
                <dd className="text-[16px] text-ans-ink">
                  {draft.to.map((r) => `${r.name} <${r.email}>`).join(", ")}
                </dd>
              </div>
              <div className="flex gap-4 border-b border-ans-line px-5 py-3">
                <dt className="w-16 shrink-0 text-[13px] font-bold tracking-[0.1em] text-ans-muted uppercase">
                  Cc
                </dt>
                <dd className="text-[16px] text-ans-ink">
                  {draft.cc.map((r) => `${r.name} <${r.email}>`).join(", ")}
                </dd>
              </div>
              <div className="flex gap-4 px-5 py-3">
                <dt className="w-16 shrink-0 text-[13px] font-bold tracking-[0.1em] text-ans-muted uppercase">
                  Subject
                </dt>
                <dd className="text-[16px] font-bold text-ans-ink">{draft.subject}</dd>
              </div>
            </dl>

            <div className="mt-6 space-y-4">
              {draft.opening.map((p) => (
                <p key={p} className="text-[16.5px] leading-relaxed text-ans-ink">
                  {p}
                </p>
              ))}
            </div>

            <div className="mt-6 space-y-5">
              {draft.points.map((point) => (
                <div key={point.title} className="border-l-[3px] border-ans-line pl-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h3 className="flex items-start gap-3 text-[17px] font-bold text-ans-navy">
                      <Dot level={point.level} />
                      {point.title}
                    </h3>
                    <LevelLabel level={point.level}>
                      {point.level === "red" ? "Red" : "Amber"}
                    </LevelLabel>
                  </div>
                  <p className="mt-2 text-[16.5px] leading-relaxed text-ans-ink">{point.body}</p>
                  <p className="mt-2 text-[14px] text-ans-muted">{point.cite}</p>
                </div>
              ))}
            </div>

            <div className="mt-6 space-y-4">
              {draft.closing.map((p) => (
                <p key={p} className="text-[16.5px] leading-relaxed text-ans-ink">
                  {p}
                </p>
              ))}
            </div>
          </div>
        </Panel>
      </div>

      <div className="space-y-6">
        <Panel>
          <SectionHeading>Drafted from</SectionHeading>
          <div className="mt-4">
            {draft.sources.map((s) => (
              <div key={s.label} className="border-t border-ans-line px-6 py-4 first:border-t-0">
                <p className="text-[12.5px] font-bold tracking-[0.1em] text-ans-navy uppercase">
                  {s.label}
                </p>
                <p className="mt-1.5 text-[15px] leading-relaxed text-ans-body">{s.detail}</p>
              </div>
            ))}
          </div>
          <p className="border-t border-ans-line px-6 py-4 text-[14px] leading-relaxed text-ans-muted">
            {draft.provenance}
          </p>
        </Panel>

        {queued && (
          <Panel>
            <SectionHeading>Why this was flagged</SectionHeading>
            <div className="px-6 pt-5 pb-6">
              <p className="text-[16px] leading-relaxed text-ans-ink">{queued.body}</p>
              <p className="mt-4 text-[12px] font-bold tracking-[0.09em] uppercase">
                {queued.counts.red > 0 && (
                  <span className="text-ans-red">{queued.counts.red} red</span>
                )}
                {queued.counts.red > 0 && queued.counts.amber > 0 && (
                  <span className="text-ans-muted"> &middot; </span>
                )}
                {queued.counts.amber > 0 && (
                  <span className="text-ans-amber">{queued.counts.amber} amber</span>
                )}
              </p>
              <p className="mt-2 text-[14px] text-ans-muted">{queued.detected}</p>
              <Link
                href="/horizon/matter-scanning"
                className="mt-5 inline-block text-[16px] text-ans-navy hover:underline"
              >
                Open the position-by-position comparison
              </Link>
            </div>
          </Panel>
        )}
      </div>
    </div>
  );
}
