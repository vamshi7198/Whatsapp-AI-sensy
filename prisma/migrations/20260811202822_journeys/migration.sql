-- CreateEnum
CREATE TYPE "JourneyStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'PAUSED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "JourneyStepType" AS ENUM ('START', 'SEND_TEMPLATE', 'SEND_MESSAGE', 'ASK_QUESTION', 'CONDITION', 'SEND_MEDIA', 'ADD_TAG', 'REMOVE_TAG', 'UPDATE_CONTACT', 'WAIT', 'WEBHOOK', 'HANDOFF', 'END');

-- CreateEnum
CREATE TYPE "JourneyTriggerType" AS ENUM ('MANUAL', 'KEYWORD', 'ANY_MESSAGE', 'TAG_ADDED', 'CAMPAIGN', 'BUTTON_REPLY');

-- CreateEnum
CREATE TYPE "JourneySessionStatus" AS ENUM ('ACTIVE', 'WAITING_FOR_REPLY', 'WAITING_UNTIL', 'HANDED_OFF', 'COMPLETED', 'FAILED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Journey" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "liveVersionId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Journey_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JourneyVersion" (
    "id" TEXT NOT NULL,
    "journeyId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "JourneyStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JourneyVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JourneyStep" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "type" "JourneyStepType" NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "x" INTEGER NOT NULL DEFAULT 0,
    "y" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "JourneyStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JourneyLink" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "fromStepId" TEXT NOT NULL,
    "optionId" TEXT,
    "toStepId" TEXT NOT NULL,

    CONSTRAINT "JourneyLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JourneyTrigger" (
    "id" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "type" "JourneyTriggerType" NOT NULL,
    "config" JSONB NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JourneyTrigger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JourneySession" (
    "id" TEXT NOT NULL,
    "journeyId" TEXT NOT NULL,
    "versionId" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "currentStepId" TEXT,
    "status" "JourneySessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "context" JSONB NOT NULL DEFAULT '{}',
    "resumeAt" TIMESTAMP(3),
    "endedReason" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "JourneySession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JourneyEvent" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JourneyEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JourneyStepRun" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "stepId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "wamid" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "JourneyStepRun_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Journey_liveVersionId_key" ON "Journey"("liveVersionId");

-- CreateIndex
CREATE INDEX "Journey_archivedAt_idx" ON "Journey"("archivedAt");

-- CreateIndex
CREATE INDEX "JourneyVersion_status_idx" ON "JourneyVersion"("status");

-- CreateIndex
CREATE UNIQUE INDEX "JourneyVersion_journeyId_version_key" ON "JourneyVersion"("journeyId", "version");

-- CreateIndex
CREATE INDEX "JourneyStep_versionId_idx" ON "JourneyStep"("versionId");

-- CreateIndex
CREATE INDEX "JourneyStep_versionId_type_idx" ON "JourneyStep"("versionId", "type");

-- CreateIndex
CREATE INDEX "JourneyLink_versionId_idx" ON "JourneyLink"("versionId");

-- CreateIndex
CREATE INDEX "JourneyLink_toStepId_idx" ON "JourneyLink"("toStepId");

-- CreateIndex
CREATE UNIQUE INDEX "JourneyLink_fromStepId_optionId_key" ON "JourneyLink"("fromStepId", "optionId");

-- CreateIndex
CREATE INDEX "JourneyTrigger_versionId_idx" ON "JourneyTrigger"("versionId");

-- CreateIndex
CREATE INDEX "JourneyTrigger_type_isActive_idx" ON "JourneyTrigger"("type", "isActive");

-- CreateIndex
CREATE INDEX "JourneySession_status_idx" ON "JourneySession"("status");

-- CreateIndex
CREATE INDEX "JourneySession_status_resumeAt_idx" ON "JourneySession"("status", "resumeAt");

-- CreateIndex
CREATE INDEX "JourneySession_contactId_idx" ON "JourneySession"("contactId");

-- CreateIndex
CREATE INDEX "JourneySession_versionId_idx" ON "JourneySession"("versionId");

-- CreateIndex
CREATE UNIQUE INDEX "JourneySession_journeyId_contactId_key" ON "JourneySession"("journeyId", "contactId");

-- CreateIndex
CREATE INDEX "JourneyEvent_sessionId_createdAt_idx" ON "JourneyEvent"("sessionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "JourneyEvent_sessionId_externalId_key" ON "JourneyEvent"("sessionId", "externalId");

-- CreateIndex
CREATE INDEX "JourneyStepRun_sessionId_createdAt_idx" ON "JourneyStepRun"("sessionId", "createdAt");

-- CreateIndex
CREATE INDEX "JourneyStepRun_stepId_idx" ON "JourneyStepRun"("stepId");

-- AddForeignKey
ALTER TABLE "Journey" ADD CONSTRAINT "Journey_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyVersion" ADD CONSTRAINT "JourneyVersion_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "Journey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyVersion" ADD CONSTRAINT "JourneyVersion_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyStep" ADD CONSTRAINT "JourneyStep_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "JourneyVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyLink" ADD CONSTRAINT "JourneyLink_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "JourneyVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyLink" ADD CONSTRAINT "JourneyLink_fromStepId_fkey" FOREIGN KEY ("fromStepId") REFERENCES "JourneyStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyLink" ADD CONSTRAINT "JourneyLink_toStepId_fkey" FOREIGN KEY ("toStepId") REFERENCES "JourneyStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyTrigger" ADD CONSTRAINT "JourneyTrigger_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "JourneyVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneySession" ADD CONSTRAINT "JourneySession_journeyId_fkey" FOREIGN KEY ("journeyId") REFERENCES "Journey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneySession" ADD CONSTRAINT "JourneySession_versionId_fkey" FOREIGN KEY ("versionId") REFERENCES "JourneyVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneySession" ADD CONSTRAINT "JourneySession_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneySession" ADD CONSTRAINT "JourneySession_currentStepId_fkey" FOREIGN KEY ("currentStepId") REFERENCES "JourneyStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyEvent" ADD CONSTRAINT "JourneyEvent_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "JourneySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyStepRun" ADD CONSTRAINT "JourneyStepRun_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "JourneySession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JourneyStepRun" ADD CONSTRAINT "JourneyStepRun_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "JourneyStep"("id") ON DELETE CASCADE ON UPDATE CASCADE;
