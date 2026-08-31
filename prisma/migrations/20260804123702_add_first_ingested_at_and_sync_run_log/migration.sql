-- CreateEnum
CREATE TYPE "SyncStatus" AS ENUM ('OK', 'BLOCKED', 'ERROR', 'SKIPPED');

-- AlterTable
ALTER TABLE "SourceDocument" ADD COLUMN     "firstIngestedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "SyncRun" (
    "id" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "trigger" TEXT NOT NULL DEFAULT 'manual',

    CONSTRAINT "SyncRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SyncRunRegulator" (
    "id" TEXT NOT NULL,
    "syncRunId" TEXT NOT NULL,
    "regulatorCode" TEXT NOT NULL,
    "status" "SyncStatus" NOT NULL,
    "scrapedRows" INTEGER NOT NULL DEFAULT 0,
    "newDocuments" INTEGER NOT NULL DEFAULT 0,
    "ingested" INTEGER NOT NULL DEFAULT 0,
    "flagged" INTEGER NOT NULL DEFAULT 0,
    "errors" INTEGER NOT NULL DEFAULT 0,
    "detail" TEXT,
    "durationMs" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncRunRegulator_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SyncRun_startedAt_idx" ON "SyncRun"("startedAt");

-- CreateIndex
CREATE INDEX "SyncRunRegulator_syncRunId_idx" ON "SyncRunRegulator"("syncRunId");

-- CreateIndex
CREATE INDEX "SyncRunRegulator_regulatorCode_createdAt_idx" ON "SyncRunRegulator"("regulatorCode", "createdAt");

-- CreateIndex
CREATE INDEX "SourceDocument_firstIngestedAt_idx" ON "SourceDocument"("firstIngestedAt");

-- AddForeignKey
ALTER TABLE "SyncRunRegulator" ADD CONSTRAINT "SyncRunRegulator_syncRunId_fkey" FOREIGN KEY ("syncRunId") REFERENCES "SyncRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;
