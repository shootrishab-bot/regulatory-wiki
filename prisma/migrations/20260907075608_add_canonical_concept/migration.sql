-- AlterTable
ALTER TABLE "TaxonomyTag" ADD COLUMN     "canonicalConceptId" TEXT;

-- CreateTable
CREATE TABLE "CanonicalConcept" (
    "id" TEXT NOT NULL,
    "facet" "Facet" NOT NULL,
    "name" TEXT NOT NULL,
    "definition" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CanonicalConcept_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CanonicalConcept_facet_idx" ON "CanonicalConcept"("facet");

-- CreateIndex
CREATE UNIQUE INDEX "CanonicalConcept_facet_name_key" ON "CanonicalConcept"("facet", "name");

-- CreateIndex
CREATE INDEX "TaxonomyTag_canonicalConceptId_idx" ON "TaxonomyTag"("canonicalConceptId");

-- AddForeignKey
ALTER TABLE "TaxonomyTag" ADD CONSTRAINT "TaxonomyTag_canonicalConceptId_fkey" FOREIGN KEY ("canonicalConceptId") REFERENCES "CanonicalConcept"("id") ON DELETE SET NULL ON UPDATE CASCADE;
