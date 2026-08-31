import Link from "next/link";
import { notFound } from "next/navigation";
import { getEntry, getTagOptions } from "@/lib/queries";
import { requireAdminSession } from "@/lib/require-admin";
import {
  formatDate,
  StatusBadge,
  isUnverifiedDate,
  UnverifiedDateBadge,
  IssuingEntityBadge,
} from "@/components/entry-list";
import { ReviewForm } from "@/components/review-form";
import { DocumentPreview } from "@/components/document-preview";

type Params = Promise<{ id: string }>;

export default async function ReviewDetailPage({ params }: { params: Params }) {
  await requireAdminSession();

  const { id } = await params;

  // requirePublic=false: the admin surface must be able to open flagged
  // entries, which is the entire point of this route. It also stays
  // reachable after resolution so the confirmation state renders.
  const entry = await getEntry(id, false);
  if (!entry) notFound();

  const doc = entry.sourceDocument;

  // includeNonActive so a human can deliberately assign a tag the automated
  // classifier is not permitted to choose (e.g. MIB's UNDER_REVIEW Tender
  // Notice type). Scoped to this entry's own regulator.
  const tagOptions = await getTagOptions({
    regulatorCode: doc.regulator.code,
    includeNonActive: true,
  });

  return (
    <div className="space-y-5">
      <Link
        href="/admin/review"
        className="inline-block text-sm text-muted-foreground hover:text-foreground"
      >
        &larr; Back to review queue
      </Link>

      <div>
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
          <span className="font-medium text-foreground">{doc.regulator.code}</span>
          <IssuingEntityBadge sourceUrl={doc.sourceUrl} />
          <span>{formatDate(doc.publishedDate)}</span>
          {isUnverifiedDate(doc.publishedDate) && <UnverifiedDateBadge />}
          <StatusBadge name={entry.statusTag?.name ?? null} />
          <span className="font-mono">{entry.documentCode}</span>
        </div>
        <h1 className="mt-1 text-lg font-semibold leading-snug tracking-tight">{entry.title}</h1>
      </div>

      {entry.needsReview ? (
        <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm">
          <span className="font-medium text-destructive">Flagged for review.</span>{" "}
          <span className="text-muted-foreground">
            Reasons: {entry.reviewReasons.length > 0 ? entry.reviewReasons.join(", ") : "none recorded"}
          </span>
        </div>
      ) : (
        <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/10 px-3 py-2 text-sm text-emerald-700 dark:text-emerald-400">
          Resolved. This entry is published and visible on the public site.{" "}
          <Link href={`/documents/${entry.id}`} className="underline underline-offset-2">
            View it there
          </Link>
          .
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="space-y-3">
          <div className="space-y-2 rounded-lg border border-border p-4 text-sm">
            <h2 className="font-medium">Current classification</h2>
            <p className="text-muted-foreground">
              <span className="text-foreground">Subject:</span>{" "}
              {entry.subject?.name ?? "Untagged"}
            </p>
            <p className="text-muted-foreground">
              <span className="text-foreground">Instrument type:</span>{" "}
              {entry.instrumentType?.name ?? "Untagged"}
            </p>
            {entry.classificationReason && (
              <p className="text-muted-foreground">
                <span className="text-foreground">Reason given:</span>{" "}
                {entry.classificationReason}
              </p>
            )}
            <p className="text-muted-foreground">
              <span className="text-foreground">Classified by:</span>{" "}
              <span className="font-mono">{entry.classifiedBy ?? "unknown"}</span>
              {entry.subjectConfidence != null && (
                <> &middot; confidence {entry.subjectConfidence.toFixed(2)}</>
              )}
            </p>
          </div>

          <DocumentPreview
            documentId={doc.id}
            fileUrl={doc.fileUrl}
            sourceUrl={doc.sourceUrl}
            compact
          />

          <p className="font-mono text-xs text-muted-foreground">source_id: {doc.sourceId}</p>
        </div>

        <ReviewForm
          entryId={entry.id}
          subjects={tagOptions.subjects}
          instrumentTypes={tagOptions.instrumentTypes}
          currentSubjectId={entry.subject?.id ?? null}
          currentInstrumentTypeId={entry.instrumentType?.id ?? null}
        />
      </div>
    </div>
  );
}
