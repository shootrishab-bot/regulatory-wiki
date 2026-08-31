-- AlterEnum
ALTER TYPE "Facet" ADD VALUE 'STATUS';

-- AlterTable
ALTER TABLE "TaxonomyTag" ADD COLUMN     "statusAppliesToSubjectIds" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "UpdateEntry" ADD COLUMN     "statusId" TEXT;

-- CreateIndex
CREATE INDEX "UpdateEntry_statusId_idx" ON "UpdateEntry"("statusId");

-- AddForeignKey
ALTER TABLE "UpdateEntry" ADD CONSTRAINT "UpdateEntry_statusId_fkey" FOREIGN KEY ("statusId") REFERENCES "TaxonomyTag"("id") ON DELETE SET NULL ON UPDATE CASCADE;
