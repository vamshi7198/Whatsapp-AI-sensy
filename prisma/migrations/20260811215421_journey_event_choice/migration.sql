-- AlterTable
ALTER TABLE "JourneyEvent" ADD COLUMN     "optionId" TEXT,
ADD COLUMN     "stepId" TEXT;

-- CreateIndex
CREATE INDEX "JourneyEvent_stepId_optionId_idx" ON "JourneyEvent"("stepId", "optionId");
