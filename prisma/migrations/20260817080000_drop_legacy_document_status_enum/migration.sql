-- Drops the legacy DocumentStatus enum column, now fully replaced by
-- UpdateEntry.statusId (a per-regulator STATUS TaxonomyTag facet). Every
-- row was already backfilled onto the new statusId column by
-- scripts/backfill-status-facet.ts (2216/2216 rows, verified 0 unmapped)
-- before this migration was written -- safe to drop.
-- AlterTable
ALTER TABLE "UpdateEntry" DROP COLUMN "status";

-- DropEnum
DROP TYPE "DocumentStatus";
