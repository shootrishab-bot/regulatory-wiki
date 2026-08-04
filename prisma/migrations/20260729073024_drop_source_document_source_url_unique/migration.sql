-- The real dedup rule for SourceDocument has always been "skip if
-- (regulatorId, sourceId) already exists" (see SourceDocument_regulatorId_sourceId_key,
-- added in 20260728081008_add_source_document_source_id, and lib/ingest.ts's
-- findExistingSourceDocument, which already keys on regulatorId_sourceId).
-- The (regulatorId, sourceUrl) unique constraint from the init migration was
-- never the real identity key -- it only happened not to collide for DoT
-- because DoT's scraper gives every document a distinct listing-page URL.
-- MTCTE has no per-document listing page: all 151 real documents share one
-- sourceUrl (the MTCTE homepage), so this constraint rejected 150 of 151
-- real, distinct documents on a real ingestion run (confirmed 2026-07-29).
-- Verified before writing this migration: zero (regulatorId, sourceId)
-- collisions across all 593 existing SourceDocument rows (592 DoT + 1 MTCTE).

-- DropIndex
DROP INDEX "SourceDocument_regulatorId_sourceUrl_key";
