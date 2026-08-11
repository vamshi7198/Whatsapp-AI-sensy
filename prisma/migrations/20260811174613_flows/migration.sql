-- CreateEnum
CREATE TYPE "FlowStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'DEPRECATED');

-- CreateTable
CREATE TABLE "Flow" (
    "id" TEXT NOT NULL,
    "externalFlowId" TEXT,
    "name" TEXT NOT NULL,
    "family" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "FlowStatus" NOT NULL DEFAULT 'DRAFT',
    "category" TEXT NOT NULL,
    "flowJson" JSONB NOT NULL,
    "jsonVersion" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "deprecatedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Flow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlowSend" (
    "id" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "campaignId" TEXT,
    "wamid" TEXT,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),

    CONSTRAINT "FlowSend_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FlowResponse" (
    "id" TEXT NOT NULL,
    "flowId" TEXT NOT NULL,
    "sendId" TEXT,
    "contactId" TEXT NOT NULL,
    "answers" JSONB NOT NULL,
    "wamid" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FlowResponse_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Flow_externalFlowId_key" ON "Flow"("externalFlowId");

-- CreateIndex
CREATE INDEX "Flow_status_idx" ON "Flow"("status");

-- CreateIndex
CREATE INDEX "Flow_family_idx" ON "Flow"("family");

-- CreateIndex
CREATE UNIQUE INDEX "Flow_family_version_key" ON "Flow"("family", "version");

-- CreateIndex
CREATE UNIQUE INDEX "FlowSend_token_key" ON "FlowSend"("token");

-- CreateIndex
CREATE INDEX "FlowSend_flowId_sentAt_idx" ON "FlowSend"("flowId", "sentAt");

-- CreateIndex
CREATE INDEX "FlowSend_contactId_idx" ON "FlowSend"("contactId");

-- CreateIndex
CREATE INDEX "FlowSend_campaignId_idx" ON "FlowSend"("campaignId");

-- CreateIndex
CREATE UNIQUE INDEX "FlowResponse_sendId_key" ON "FlowResponse"("sendId");

-- CreateIndex
CREATE UNIQUE INDEX "FlowResponse_wamid_key" ON "FlowResponse"("wamid");

-- CreateIndex
CREATE INDEX "FlowResponse_flowId_receivedAt_idx" ON "FlowResponse"("flowId", "receivedAt");

-- CreateIndex
CREATE INDEX "FlowResponse_contactId_idx" ON "FlowResponse"("contactId");

-- AddForeignKey
ALTER TABLE "Flow" ADD CONSTRAINT "Flow_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowSend" ADD CONSTRAINT "FlowSend_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowSend" ADD CONSTRAINT "FlowSend_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowResponse" ADD CONSTRAINT "FlowResponse_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "Flow"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowResponse" ADD CONSTRAINT "FlowResponse_sendId_fkey" FOREIGN KEY ("sendId") REFERENCES "FlowSend"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FlowResponse" ADD CONSTRAINT "FlowResponse_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
