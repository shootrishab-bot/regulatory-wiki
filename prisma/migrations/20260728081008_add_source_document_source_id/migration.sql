-- AlterTable
ALTER TABLE "SourceDocument" ADD COLUMN     "sourceId" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "SourceDocument_regulatorId_sourceId_key" ON "SourceDocument"("regulatorId", "sourceId");
