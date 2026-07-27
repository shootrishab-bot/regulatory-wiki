-- CreateEnum
CREATE TYPE "Facet" AS ENUM ('SUBJECT', 'INSTRUMENT_TYPE', 'APPLICABILITY');

-- CreateEnum
CREATE TYPE "TagStatus" AS ENUM ('ACTIVE', 'UNDER_REVIEW', 'DEPRECATED');

-- CreateEnum
CREATE TYPE "SourceNature" AS ENUM ('PRIMARY', 'DIGEST_SUMMARY');

-- CreateEnum
CREATE TYPE "DocumentStatus" AS ENUM ('IN_FORCE', 'DRAFT_CONSULTATION', 'AMENDED', 'SUPERSEDED_REPEALED');

-- CreateEnum
CREATE TYPE "RelationshipType" AS ENUM ('AMENDS', 'SUPERSEDES', 'EXTENDS_TIMELINE');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'VIEWER');

-- CreateTable
CREATE TABLE "Domain" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Domain_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Regulator" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domainId" TEXT NOT NULL,
    "websiteUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Regulator_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxonomyTag" (
    "id" TEXT NOT NULL,
    "regulatorId" TEXT NOT NULL,
    "facet" "Facet" NOT NULL,
    "name" TEXT NOT NULL,
    "shortCode" TEXT NOT NULL,
    "definition" TEXT,
    "parentId" TEXT,
    "status" "TagStatus" NOT NULL DEFAULT 'ACTIVE',
    "versionAdded" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxonomyTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TaxonomyProposal" (
    "id" TEXT NOT NULL,
    "regulatorId" TEXT NOT NULL,
    "facet" "Facet" NOT NULL,
    "proposedName" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "exampleEntryIds" TEXT[],
    "status" TEXT NOT NULL DEFAULT 'pending',
    "resolvedTagId" TEXT,
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TaxonomyProposal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SourceDocument" (
    "id" TEXT NOT NULL,
    "regulatorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "fileUrl" TEXT,
    "s3Key" TEXT,
    "publishedDate" TIMESTAMP(3),
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rawTextS3Key" TEXT,
    "isDigest" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "SourceDocument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UpdateEntry" (
    "id" TEXT NOT NULL,
    "documentCode" TEXT NOT NULL,
    "sourceDocumentId" TEXT NOT NULL,
    "sourceNature" "SourceNature" NOT NULL DEFAULT 'PRIMARY',
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "subjectId" TEXT,
    "instrumentTypeId" TEXT,
    "status" "DocumentStatus" NOT NULL DEFAULT 'IN_FORCE',
    "subjectConfidence" DOUBLE PRECISION,
    "instrumentConfidence" DOUBLE PRECISION,
    "statusConfidence" DOUBLE PRECISION,
    "classificationReason" TEXT,
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "needsSplit" BOOLEAN NOT NULL DEFAULT false,
    "reviewReasons" TEXT[],
    "taxonomyVersion" TEXT,
    "classifiedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "UpdateEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntryApplicability" (
    "id" TEXT NOT NULL,
    "updateEntryId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "EntryApplicability_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EntryRelationship" (
    "id" TEXT NOT NULL,
    "fromEntryId" TEXT NOT NULL,
    "toEntryId" TEXT,
    "type" "RelationshipType" NOT NULL,
    "targetHint" TEXT NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "EntryRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "role" "Role" NOT NULL DEFAULT 'VIEWER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Domain_name_key" ON "Domain"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Regulator_code_key" ON "Regulator"("code");

-- CreateIndex
CREATE INDEX "Regulator_domainId_idx" ON "Regulator"("domainId");

-- CreateIndex
CREATE INDEX "TaxonomyTag_regulatorId_facet_idx" ON "TaxonomyTag"("regulatorId", "facet");

-- CreateIndex
CREATE UNIQUE INDEX "TaxonomyTag_regulatorId_facet_name_key" ON "TaxonomyTag"("regulatorId", "facet", "name");

-- CreateIndex
CREATE INDEX "TaxonomyProposal_regulatorId_status_idx" ON "TaxonomyProposal"("regulatorId", "status");

-- CreateIndex
CREATE INDEX "SourceDocument_regulatorId_idx" ON "SourceDocument"("regulatorId");

-- CreateIndex
CREATE UNIQUE INDEX "SourceDocument_regulatorId_sourceUrl_key" ON "SourceDocument"("regulatorId", "sourceUrl");

-- CreateIndex
CREATE UNIQUE INDEX "UpdateEntry_documentCode_key" ON "UpdateEntry"("documentCode");

-- CreateIndex
CREATE INDEX "UpdateEntry_subjectId_idx" ON "UpdateEntry"("subjectId");

-- CreateIndex
CREATE INDEX "UpdateEntry_instrumentTypeId_idx" ON "UpdateEntry"("instrumentTypeId");

-- CreateIndex
CREATE INDEX "UpdateEntry_needsReview_idx" ON "UpdateEntry"("needsReview");

-- CreateIndex
CREATE INDEX "UpdateEntry_needsSplit_idx" ON "UpdateEntry"("needsSplit");

-- CreateIndex
CREATE INDEX "UpdateEntry_sourceDocumentId_idx" ON "UpdateEntry"("sourceDocumentId");

-- CreateIndex
CREATE UNIQUE INDEX "EntryApplicability_updateEntryId_tagId_key" ON "EntryApplicability"("updateEntryId", "tagId");

-- CreateIndex
CREATE INDEX "EntryRelationship_fromEntryId_idx" ON "EntryRelationship"("fromEntryId");

-- CreateIndex
CREATE INDEX "EntryRelationship_toEntryId_idx" ON "EntryRelationship"("toEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- AddForeignKey
ALTER TABLE "Regulator" ADD CONSTRAINT "Regulator_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "Domain"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxonomyTag" ADD CONSTRAINT "TaxonomyTag_regulatorId_fkey" FOREIGN KEY ("regulatorId") REFERENCES "Regulator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxonomyTag" ADD CONSTRAINT "TaxonomyTag_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "TaxonomyTag"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TaxonomyProposal" ADD CONSTRAINT "TaxonomyProposal_regulatorId_fkey" FOREIGN KEY ("regulatorId") REFERENCES "Regulator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SourceDocument" ADD CONSTRAINT "SourceDocument_regulatorId_fkey" FOREIGN KEY ("regulatorId") REFERENCES "Regulator"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpdateEntry" ADD CONSTRAINT "UpdateEntry_sourceDocumentId_fkey" FOREIGN KEY ("sourceDocumentId") REFERENCES "SourceDocument"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpdateEntry" ADD CONSTRAINT "UpdateEntry_subjectId_fkey" FOREIGN KEY ("subjectId") REFERENCES "TaxonomyTag"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UpdateEntry" ADD CONSTRAINT "UpdateEntry_instrumentTypeId_fkey" FOREIGN KEY ("instrumentTypeId") REFERENCES "TaxonomyTag"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntryApplicability" ADD CONSTRAINT "EntryApplicability_updateEntryId_fkey" FOREIGN KEY ("updateEntryId") REFERENCES "UpdateEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntryApplicability" ADD CONSTRAINT "EntryApplicability_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "TaxonomyTag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntryRelationship" ADD CONSTRAINT "EntryRelationship_fromEntryId_fkey" FOREIGN KEY ("fromEntryId") REFERENCES "UpdateEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntryRelationship" ADD CONSTRAINT "EntryRelationship_toEntryId_fkey" FOREIGN KEY ("toEntryId") REFERENCES "UpdateEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;
