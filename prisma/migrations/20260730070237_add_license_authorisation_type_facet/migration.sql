-- Adds the License/Authorisation Type facet: a new multi-tag dimension for
-- DoT documents (which legacy license(s)/new-regime authorisation(s) a
-- document concerns), modeled on Applicability's pattern -- its own
-- dedicated join table, not a reuse of EntryApplicability, so Applicability
-- queries can never accidentally pick up License/Authorisation Type tags.
-- Purely additive: a new enum value and a new, empty table. Confirmed
-- before writing this migration: no existing "EntryLicenseAuthorisationType"
-- table, no existing "LICENSE_AUTHORISATION_TYPE" enum value, and none of
-- the 43 existing TaxonomyTag rows (across DOT and MTCTE) are touched by
-- this migration -- this only adds new, unused schema surface.

-- AlterEnum
ALTER TYPE "Facet" ADD VALUE 'LICENSE_AUTHORISATION_TYPE';

-- CreateTable
CREATE TABLE "EntryLicenseAuthorisationType" (
    "id" TEXT NOT NULL,
    "updateEntryId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,

    CONSTRAINT "EntryLicenseAuthorisationType_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "EntryLicenseAuthorisationType_updateEntryId_tagId_key" ON "EntryLicenseAuthorisationType"("updateEntryId", "tagId");

-- AddForeignKey
ALTER TABLE "EntryLicenseAuthorisationType" ADD CONSTRAINT "EntryLicenseAuthorisationType_updateEntryId_fkey" FOREIGN KEY ("updateEntryId") REFERENCES "UpdateEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EntryLicenseAuthorisationType" ADD CONSTRAINT "EntryLicenseAuthorisationType_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "TaxonomyTag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
