/**
 * Shared read queries for the public wiki and the admin review UI.
 *
 * Both surfaces read the same UpdateEntry/SourceDocument/TaxonomyTag tables,
 * so the filter-building lives here once rather than being duplicated (and
 * drifting) between them. The single hard rule enforced at this layer: the
 * public browse/detail queries ALWAYS constrain needsReview=false, and the
 * admin queries ALWAYS constrain needsReview=true. Neither can be widened
 * by a caller passing a stray filter, because the flag is set inside these
 * functions rather than taken as an argument.
 *
 * Filter option lists (regulators, subjects, instrument types) are read from
 * Postgres, never hardcoded -- adding a regulator or a tag must show up in
 * the UI without a code change.
 */

import { Facet, TagStatus } from "@/app/generated/prisma/enums";
import type { Prisma } from "@/app/generated/prisma/client";
import { prisma } from "./prisma";
import { withDbRetry } from "./db-retry";

export const PAGE_SIZE = 25;

export const SORT_OPTIONS = {
  newest: "Newest first",
  oldest: "Oldest first",
  title: "Title A-Z",
  regulator: "Regulator",
} as const;

export type SortKey = keyof typeof SORT_OPTIONS;

export function isSortKey(v: string | undefined): v is SortKey {
  return !!v && v in SORT_OPTIONS;
}

/**
 * The four facet filters each take one value or several. A single string is
 * kept working because most callers have exactly one -- /regulators/[code]
 * and the tag pages pass one and mean one -- while the filter bars submit a
 * repeated query parameter and get an array. Empty array means "no filter",
 * the same as undefined.
 */
export type FilterValue = string | string[];

export interface BrowseFilters {
  domain?: FilterValue; // Domain.id -- every regulator in that sector
  regulator?: FilterValue; // Regulator.code
  subject?: FilterValue; // TaxonomyTag.id
  instrument?: FilterValue; // TaxonomyTag.id
  from?: string; // ISO date (yyyy-mm-dd)
  to?: string; // ISO date (yyyy-mm-dd)
  q?: string; // free-text over title
  sort?: SortKey;
  page?: number; // 1-based
}

/** One value, several, or none -- always as a list, with blanks dropped. */
export function toList(v: FilterValue | undefined): string[] {
  if (v === undefined) return [];
  return (Array.isArray(v) ? v : [v]).map((x) => x.trim()).filter(Boolean);
}

/** Prisma equality for one value, `in` for several, undefined for none. */
function oneOf(values: string[]): string | { in: string[] } | undefined {
  if (values.length === 0) return undefined;
  return values.length === 1 ? values[0] : { in: values };
}

/**
 * publishedDate is nullable, so null placement is stated explicitly on every
 * date sort rather than left to the driver default -- otherwise "oldest
 * first" would lead with undated rows, which reads as a bug.
 */
function buildOrderBy(sort: SortKey | undefined): Prisma.UpdateEntryOrderByWithRelationInput[] {
  switch (sort) {
    case "oldest":
      return [
        { sourceDocument: { publishedDate: { sort: "asc", nulls: "last" } } },
        { createdAt: "asc" },
      ];
    case "title":
      return [{ title: "asc" }];
    case "regulator":
      return [
        { sourceDocument: { regulator: { code: "asc" } } },
        { sourceDocument: { publishedDate: { sort: "desc", nulls: "last" } } },
      ];
    case "newest":
    default:
      return [
        { sourceDocument: { publishedDate: { sort: "desc", nulls: "last" } } },
        { createdAt: "desc" },
      ];
  }
}

/**
 * Builds the shared WHERE clause. `needsReview` is a required explicit
 * argument rather than part of BrowseFilters so a caller can never
 * accidentally omit it and leak flagged rows into the public site.
 */
function buildWhere(
  filters: BrowseFilters,
  needsReview: boolean
): Prisma.UpdateEntryWhereInput {
  const where: Prisma.UpdateEntryWhereInput = { needsReview };

  const sourceDocument: Prisma.SourceDocumentWhereInput = {};
  let hasSourceDocFilter = false;

  // Regulator wins over domain when both are set: naming regulators is the
  // more specific instruction, and a regulator is always inside exactly one
  // domain, so the pair can only ever narrow to the regulators anyway.
  const regulators = toList(filters.regulator);
  const domainIds = toList(filters.domain);
  if (regulators.length > 0) {
    sourceDocument.regulator = { code: oneOf(regulators) };
    hasSourceDocFilter = true;
  } else if (domainIds.length > 0) {
    sourceDocument.regulator = { domainId: oneOf(domainIds) };
    hasSourceDocFilter = true;
  }

  // Date range filters the SOURCE document's real published date. Rows with
  // a null publishedDate (15 real MIB documents, e.g. financial-year-only
  // budget rows) are genuinely undated and will correctly fall outside any
  // explicit range rather than being silently coerced to a date.
  if (filters.from || filters.to) {
    const publishedDate: Prisma.DateTimeNullableFilter = {};
    if (filters.from) {
      const d = new Date(filters.from);
      if (!isNaN(d.getTime())) publishedDate.gte = d;
    }
    if (filters.to) {
      // Inclusive end-of-day so a "to" of 2026-07-15 includes that day.
      const d = new Date(filters.to);
      if (!isNaN(d.getTime())) {
        d.setHours(23, 59, 59, 999);
        publishedDate.lte = d;
      }
    }
    if (publishedDate.gte || publishedDate.lte) {
      sourceDocument.publishedDate = publishedDate;
      hasSourceDocFilter = true;
    }
  }

  if (hasSourceDocFilter) {
    where.sourceDocument = sourceDocument;
  }

  const subjectIds = toList(filters.subject);
  const instrumentIds = toList(filters.instrument);
  if (subjectIds.length > 0) where.subjectId = oneOf(subjectIds);
  if (instrumentIds.length > 0) where.instrumentTypeId = oneOf(instrumentIds);

  if (filters.q && filters.q.trim()) {
    where.title = { contains: filters.q.trim(), mode: "insensitive" };
  }

  return where;
}

const ENTRY_LIST_SELECT = {
  id: true,
  documentCode: true,
  title: true,
  needsReview: true,
  reviewReasons: true,
  subjectConfidence: true,
  classificationReason: true,
  subject: { select: { id: true, name: true } },
  instrumentType: { select: { id: true, name: true } },
  statusTag: { select: { id: true, name: true } },
  sourceDocument: {
    select: {
      id: true,
      publishedDate: true,
      sourceUrl: true,
      fileUrl: true,
      sourceId: true,
      regulator: { select: { code: true, name: true } },
    },
  },
} satisfies Prisma.UpdateEntrySelect;

export type EntryListItem = Prisma.UpdateEntryGetPayload<{
  select: typeof ENTRY_LIST_SELECT;
}>;

async function listEntries(filters: BrowseFilters, needsReview: boolean) {
  const where = buildWhere(filters, needsReview);
  const page = Math.max(1, filters.page ?? 1);

  const [total, entries] = await Promise.all([
    withDbRetry(() => prisma.updateEntry.count({ where }), "listEntries count"),
    withDbRetry(() => prisma.updateEntry.findMany({
      where,
      select: ENTRY_LIST_SELECT,
      orderBy: buildOrderBy(filters.sort),
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }), "listEntries findMany"),
  ]);

  return {
    entries,
    total,
    page,
    pageCount: Math.max(1, Math.ceil(total / PAGE_SIZE)),
  };
}

/** Public browse: only unflagged entries are ever returned. */
export function listPublicEntries(filters: BrowseFilters) {
  return listEntries(filters, false);
}

/** Admin review queue: only flagged entries are ever returned. */
export function listFlaggedEntries(filters: BrowseFilters) {
  return listEntries(filters, true);
}

const ENTRY_DETAIL_SELECT = {
  id: true,
  documentCode: true,
  title: true,
  summary: true,
  needsReview: true,
  reviewReasons: true,
  subjectConfidence: true,
  instrumentConfidence: true,
  statusConfidence: true,
  classificationReason: true,
  classifiedBy: true,
  taxonomyVersion: true,
  createdAt: true,
  updatedAt: true,
  subject: { select: { id: true, name: true, definition: true } },
  instrumentType: { select: { id: true, name: true, definition: true } },
  statusTag: { select: { id: true, name: true, definition: true } },
  sourceDocument: {
    select: {
      id: true,
      sourceId: true,
      title: true,
      sourceUrl: true,
      fileUrl: true,
      publishedDate: true,
      discoveredAt: true,
      regulator: { select: { id: true, code: true, name: true, websiteUrl: true } },
    },
  },
} satisfies Prisma.UpdateEntrySelect;

export type EntryDetail = Prisma.UpdateEntryGetPayload<{
  select: typeof ENTRY_DETAIL_SELECT;
}>;

/**
 * Detail lookup. `requirePublic` is explicit at the call site: the public
 * detail route passes true so a flagged document 404s there rather than
 * being reachable by guessing its id, while the admin route passes false.
 */
export async function getEntry(id: string, requirePublic: boolean): Promise<EntryDetail | null> {
  const entry = await withDbRetry(
    () =>
      prisma.updateEntry.findUnique({
        where: { id },
        select: ENTRY_DETAIL_SELECT,
      }),
    "getEntry"
  );
  if (!entry) return null;
  if (requirePublic && entry.needsReview) return null;
  return entry;
}

// ---------------------------------------------------------------------------
// Filter option lists -- all read from Postgres, none hardcoded.
// ---------------------------------------------------------------------------

export async function getRegulators() {
  return withDbRetry(
    () =>
      prisma.regulator.findMany({
        select: { id: true, code: true, name: true },
        orderBy: { code: "asc" },
      }),
    "getRegulators"
  );
}

/**
 * Tag options for the filter dropdowns and the admin correction form.
 *
 * Includes UNDER_REVIEW tags only when `includeNonActive` is set (the admin
 * form passes it, so a human can deliberately assign a tag the automated
 * classifier is not allowed to choose -- e.g. MIB's Tender Notice, which is
 * held UNDER_REVIEW precisely because no real document has matched it yet).
 * The public filter list passes false and shows ACTIVE tags only.
 */
export async function getTagOptions(opts: {
  regulatorCode?: string;
  includeNonActive?: boolean;
}) {
  const tags = await withDbRetry(() => prisma.taxonomyTag.findMany({
    where: {
      facet: { in: [Facet.SUBJECT, Facet.INSTRUMENT_TYPE] },
      ...(opts.includeNonActive ? {} : { status: TagStatus.ACTIVE }),
      ...(opts.regulatorCode ? { regulator: { code: opts.regulatorCode } } : {}),
    },
    select: {
      id: true,
      name: true,
      facet: true,
      status: true,
      regulator: { select: { code: true } },
    },
    orderBy: [{ regulator: { code: "asc" } }, { name: "asc" }],
  }), "getTagOptions");

  return {
    subjects: tags.filter((t) => t.facet === Facet.SUBJECT),
    instrumentTypes: tags.filter((t) => t.facet === Facet.INSTRUMENT_TYPE),
  };
}

export type TagOption = Awaited<ReturnType<typeof getTagOptions>>["subjects"][number];

export interface RegulatorTagOptions {
  subjects: TagOption[];
  instrumentTypes: TagOption[];
}

/**
 * Every regulator's ACTIVE Subject and Instrument Type tags, keyed by
 * regulator code.
 *
 * For the filter bars, which need to swap those two dropdowns the instant a
 * regulator is picked rather than after a round trip -- see
 * components/tag-scoped-selects.tsx. Sending the whole map is NOT the
 * combined-vocabulary list the facet pages exist to avoid: the dropdowns
 * only ever render the tags of the one regulator currently selected, so no
 * user is ever shown two regulators' incomparable vocabularies side by side.
 */
export async function getTagOptionsByRegulator(): Promise<Record<string, RegulatorTagOptions>> {
  const { subjects, instrumentTypes } = await getTagOptions({ includeNonActive: false });
  const byCode: Record<string, RegulatorTagOptions> = {};
  const push = (t: TagOption, key: keyof RegulatorTagOptions) => {
    const code = t.regulator.code;
    byCode[code] ??= { subjects: [], instrumentTypes: [] };
    byCode[code][key].push(t);
  };
  for (const t of subjects) push(t, "subjects");
  for (const t of instrumentTypes) push(t, "instrumentTypes");
  return byCode;
}

/** Per-regulator flagged counts, for the admin queue's summary strip. */
export async function getFlaggedCountsByRegulator() {
  const rows = await withDbRetry(() => prisma.$queryRaw<{ code: string; name: string; count: bigint }[]>`
    SELECT r.code, r.name, COUNT(ue.id)::bigint AS count
    FROM "Regulator" r
    JOIN "SourceDocument" sd ON sd."regulatorId" = r.id
    JOIN "UpdateEntry" ue ON ue."sourceDocumentId" = sd.id
    WHERE ue."needsReview" = true
    GROUP BY r.code, r.name
    ORDER BY r.code ASC
  `, "regulator counts");
  return rows.map((r) => ({ code: r.code, name: r.name, count: Number(r.count) }));
}

/** Per-regulator public (unflagged) counts, for the browse page header. */
export async function getPublicCountsByRegulator() {
  const rows = await withDbRetry(() => prisma.$queryRaw<{ code: string; name: string; count: bigint }[]>`
    SELECT r.code, r.name, COUNT(ue.id)::bigint AS count
    FROM "Regulator" r
    JOIN "SourceDocument" sd ON sd."regulatorId" = r.id
    JOIN "UpdateEntry" ue ON ue."sourceDocumentId" = sd.id
    WHERE ue."needsReview" = false
    GROUP BY r.code, r.name
    ORDER BY r.code ASC
  `, "regulator counts");
  return rows.map((r) => ({ code: r.code, name: r.name, count: Number(r.count) }));
}

// ---------------------------------------------------------------------------
// Browse-by hub queries.
//
// These back the dedicated /regulators, /domains, /subjects and /instruments
// pages that replaced the single global filter bar. The point of the split:
// Subject and Instrument Type vocabularies are deliberately per-regulator and
// are NOT comparable across regulators, so one combined dropdown mixing all
// three regulators' tags was actively misleading. Each hub now scopes to one
// regulator at a time.
// ---------------------------------------------------------------------------

/** Domains with their regulators and real published-document counts. */
export async function getDomainOverview() {
  const rows = await withDbRetry(
    () =>
      prisma.$queryRaw<
        { domainId: string; domain: string; code: string; name: string; published: bigint }[]
      >`
        SELECT d.id AS "domainId", d.name AS domain, r.code, r.name,
               COUNT(ue.id) FILTER (WHERE NOT ue."needsReview")::bigint AS published
        FROM "Domain" d
        JOIN "Regulator" r ON r."domainId" = d.id
        LEFT JOIN "SourceDocument" sd ON sd."regulatorId" = r.id
        LEFT JOIN "UpdateEntry" ue ON ue."sourceDocumentId" = sd.id
        GROUP BY d.id, d.name, r.code, r.name
        ORDER BY d.name ASC, r.code ASC
      `,
    "getDomainOverview"
  );

  const byDomain = new Map<
    string,
    { id: string; name: string; regulators: { code: string; name: string; published: number }[] }
  >();
  for (const r of rows) {
    if (!byDomain.has(r.domainId)) {
      byDomain.set(r.domainId, { id: r.domainId, name: r.domain, regulators: [] });
    }
    byDomain.get(r.domainId)!.regulators.push({
      code: r.code,
      name: r.name,
      published: Number(r.published),
    });
  }
  return [...byDomain.values()];
}

/** One regulator plus its own tag vocabularies and real counts. */
export async function getRegulatorDetail(code: string) {
  const regulator = await withDbRetry(
    () =>
      prisma.regulator.findUnique({
        where: { code },
        select: {
          id: true,
          code: true,
          name: true,
          websiteUrl: true,
          domain: { select: { id: true, name: true } },
        },
      }),
    "getRegulatorDetail"
  );
  if (!regulator) return null;

  const tagRows = await withDbRetry(
    () =>
      prisma.$queryRaw<
        { id: string; name: string; facet: string; definition: string | null; published: bigint }[]
      >`
        SELECT t.id, t.name, t.facet::text, t.definition,
               COUNT(ue.id) FILTER (WHERE NOT ue."needsReview")::bigint AS published
        FROM "TaxonomyTag" t
        LEFT JOIN "UpdateEntry" ue
          ON (ue."subjectId" = t.id OR ue."instrumentTypeId" = t.id)
        WHERE t."regulatorId" = ${regulator.id}
          AND t.facet IN ('SUBJECT', 'INSTRUMENT_TYPE')
          AND t.status = 'ACTIVE'
        GROUP BY t.id, t.name, t.facet, t.definition
        ORDER BY COUNT(ue.id) DESC, t.name ASC
      `,
    "getRegulatorDetail tags"
  );

  const counts = await withDbRetry(
    () =>
      prisma.$queryRaw<{ published: bigint; flagged: bigint }[]>`
        SELECT COUNT(ue.id) FILTER (WHERE NOT ue."needsReview")::bigint AS published,
               COUNT(ue.id) FILTER (WHERE ue."needsReview")::bigint AS flagged
        FROM "SourceDocument" sd
        JOIN "UpdateEntry" ue ON ue."sourceDocumentId" = sd.id
        WHERE sd."regulatorId" = ${regulator.id}
      `,
    "getRegulatorDetail counts"
  );

  // The other regulators sharing this one's domain. Sideways navigation the
  // top nav can't offer: it only knows the full list, not who the peers are.
  const siblingRows = await withDbRetry(
    () =>
      prisma.$queryRaw<{ code: string; name: string; published: bigint }[]>`
        SELECT r.code, r.name,
               COUNT(ue.id) FILTER (WHERE NOT ue."needsReview")::bigint AS published
        FROM "Regulator" r
        LEFT JOIN "SourceDocument" sd ON sd."regulatorId" = r.id
        LEFT JOIN "UpdateEntry" ue ON ue."sourceDocumentId" = sd.id
        WHERE r."domainId" = ${regulator.domain.id}
          AND r.id <> ${regulator.id}
        GROUP BY r.code, r.name
        ORDER BY COUNT(ue.id) DESC, r.code ASC
      `,
    "getRegulatorDetail siblings"
  );

  const map = (facet: string) =>
    tagRows
      .filter((t) => t.facet === facet)
      .map((t) => ({
        id: t.id,
        name: t.name,
        definition: t.definition,
        published: Number(t.published),
      }));

  const published = Number(counts[0]?.published ?? 0);
  const siblings = siblingRows.map((r) => ({
    code: r.code,
    name: r.name,
    published: Number(r.published),
  }));

  return {
    regulator,
    subjects: map("SUBJECT"),
    instrumentTypes: map("INSTRUMENT_TYPE"),
    published,
    flagged: Number(counts[0]?.flagged ?? 0),
    siblings,
    // Domain totals, counting this regulator alongside its peers.
    domainRegulators: siblings.length + 1,
    domainPublished: siblings.reduce((s, r) => s + r.published, published),
  };
}

/** All ACTIVE tags of one facet, grouped by regulator, with real counts. */
export async function getTagsByFacet(facet: "SUBJECT" | "INSTRUMENT_TYPE") {
  const rows = await withDbRetry(
    () =>
      prisma.$queryRaw<
        {
          id: string;
          name: string;
          definition: string | null;
          code: string;
          regulator: string;
          published: bigint;
        }[]
      >`
        SELECT t.id, t.name, t.definition, r.code, r.name AS regulator,
               COUNT(ue.id) FILTER (WHERE NOT ue."needsReview")::bigint AS published
        FROM "TaxonomyTag" t
        JOIN "Regulator" r ON r.id = t."regulatorId"
        LEFT JOIN "UpdateEntry" ue
          ON (CASE WHEN t.facet = 'SUBJECT' THEN ue."subjectId" ELSE ue."instrumentTypeId" END) = t.id
        WHERE t.facet = CAST(${facet} AS "Facet") AND t.status = 'ACTIVE'
        GROUP BY t.id, t.name, t.definition, r.code, r.name
        ORDER BY r.code ASC, COUNT(ue.id) DESC, t.name ASC
      `,
    "getTagsByFacet"
  );

  const grouped = new Map<
    string,
    { code: string; name: string; tags: { id: string; name: string; definition: string | null; published: number }[] }
  >();
  for (const r of rows) {
    if (!grouped.has(r.code)) grouped.set(r.code, { code: r.code, name: r.regulator, tags: [] });
    grouped.get(r.code)!.tags.push({
      id: r.id,
      name: r.name,
      definition: r.definition,
      published: Number(r.published),
    });
  }
  return [...grouped.values()];
}

/** A single tag with its regulator, for the tag detail pages. */
export async function getTag(id: string) {
  return withDbRetry(
    () =>
      prisma.taxonomyTag.findUnique({
        where: { id },
        select: {
          id: true,
          name: true,
          definition: true,
          notes: true,
          facet: true,
          status: true,
          regulator: { select: { code: true, name: true } },
        },
      }),
    "getTag"
  );
}
