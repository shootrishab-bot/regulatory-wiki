import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DocumentPreview } from "@/components/document-preview";
import { Badge } from "@/components/ui/badge";
import { Crumbs } from "@/components/page-shell";
import {
  formatDate,
  StatusBadge,
  isUnverifiedDate,
  UnverifiedDateBadge,
  SubjectBadge,
  InstrumentBadge,
} from "@/components/entry-list";
import { getEntry } from "@/lib/queries";

type Params = Promise<{ id: string }>;

export default async function DocumentDetailPage({ params }: { params: Params }) {
  const { id } = await params;

  // requirePublic=true: a flagged entry 404s here rather than being reachable
  // by guessing its id.
  const entry = await getEntry(id, true);
  if (!entry) notFound();

  const doc = entry.sourceDocument;

  return (
    <div>
      <Crumbs
        items={[
          { label: "All documents", href: "/documents" },
          { label: doc.regulator.code, href: `/regulators/${doc.regulator.code}` },
          { label: entry.documentCode },
        ]}
      />

      <h1 className="text-2xl font-semibold leading-snug tracking-tight text-balance">
        {entry.title}
      </h1>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Link href={`/regulators/${doc.regulator.code}`}>
          <Badge variant="secondary" className="cursor-pointer text-sm">
            {doc.regulator.code}
          </Badge>
        </Link>
        <span className="text-sm text-muted-foreground">{formatDate(doc.publishedDate)}</span>
        {isUnverifiedDate(doc.publishedDate) && <UnverifiedDateBadge />}
        <StatusBadge status={entry.status} />
        <code className="rounded bg-muted px-1.5 py-0.5 font-mono text-xs">
          {entry.documentCode}
        </code>
      </div>

      {isUnverifiedDate(doc.publishedDate) && (
        <p className="mt-4 rounded-xl border border-amber-500/40 bg-amber-500/10 px-4 py-3 text-sm text-amber-800 dark:text-amber-300">
          <span className="font-medium">Unverified date.</span> The published date recorded for
          this document is later than today, which cannot be correct. Treat it as unreliable;
          the linked source file is authoritative.
        </p>
      )}

      <div className="mt-6 grid gap-5 lg:grid-cols-3">
        <div className="space-y-5 lg:col-span-2">
          <DocumentPreview
            documentId={doc.id}
            fileUrl={doc.fileUrl}
            sourceUrl={doc.sourceUrl}
          />

          {doc.sourceUrl && doc.sourceUrl !== doc.fileUrl && (
            <p className="text-sm text-muted-foreground">
              Listed on{" "}
              <a
                href={doc.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 underline underline-offset-2 hover:text-foreground"
              >
                {doc.regulator.name}
                <ExternalLink className="size-3.5" aria-hidden />
              </a>
              . The regulator&apos;s own file is the authoritative version.
            </p>
          )}

          <details className="rounded-xl border p-4">
            <summary className="cursor-pointer text-sm font-medium">
              Classification detail
            </summary>
            <div className="mt-3 space-y-1.5 text-sm text-muted-foreground">
              {entry.classificationReason && <p>{entry.classificationReason}</p>}
              <p>
                Classified by <span className="font-mono">{entry.classifiedBy ?? "unknown"}</span>
                {entry.subjectConfidence != null && (
                  <> &middot; confidence {entry.subjectConfidence.toFixed(2)}</>
                )}
                {entry.taxonomyVersion && <> &middot; taxonomy {entry.taxonomyVersion}</>}
              </p>
              <p className="font-mono text-xs">source_id: {doc.sourceId}</p>
            </div>
          </details>
        </div>

        <Card className="h-fit">
          <CardHeader>
            <CardTitle className="text-lg">Tags</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <p className="mb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Subject
              </p>
              {entry.subject ? (
                <Link href={`/subjects/${entry.subject.id}`} className="inline-block">
                  <SubjectBadge name={entry.subject.name} />
                </Link>
              ) : (
                <span className="text-sm text-muted-foreground">Untagged</span>
              )}
              {entry.subject?.definition && (
                <p className="mt-1 text-sm text-muted-foreground">{entry.subject.definition}</p>
              )}
            </div>
            <div>
              <p className="mb-1.5 text-xs font-medium tracking-wide text-muted-foreground uppercase">
                Instrument type
              </p>
              {entry.instrumentType ? (
                <Link href={`/instruments/${entry.instrumentType.id}`} className="inline-block">
                  <InstrumentBadge name={entry.instrumentType.name} />
                </Link>
              ) : (
                <span className="text-sm text-muted-foreground">Untagged</span>
              )}
              {entry.instrumentType?.definition && (
                <p className="mt-1 text-sm text-muted-foreground">
                  {entry.instrumentType.definition}
                </p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
