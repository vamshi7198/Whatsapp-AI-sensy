-- CreateEnum
CREATE TYPE "Role" AS ENUM ('ADMIN', 'MANAGER', 'AGENT');

-- CreateEnum
CREATE TYPE "OptInStatus" AS ENUM ('UNKNOWN', 'OPTED_IN', 'OPTED_OUT');

-- CreateEnum
CREATE TYPE "WhatsAppStatus" AS ENUM ('UNKNOWN', 'VALID', 'INVALID');

-- CreateEnum
CREATE TYPE "TemplateStatus" AS ENUM ('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'PAUSED', 'DISABLED');

-- CreateEnum
CREATE TYPE "TemplateCategory" AS ENUM ('MARKETING', 'UTILITY', 'AUTHENTICATION');

-- CreateEnum
CREATE TYPE "CampaignStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'QUEUED', 'RUNNING', 'COMPLETED', 'PARTIALLY_FAILED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RecipientStatus" AS ENUM ('PENDING', 'QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "MessageStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "MessageDirection" AS ENUM ('INBOUND', 'OUTBOUND');

-- CreateEnum
CREATE TYPE "AudienceType" AS ENUM ('ALL_CONTACTS', 'TAG', 'TAGS', 'SELECTED', 'CSV_UPLOAD');

-- CreateEnum
CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'PENDING', 'CLOSED');

-- CreateEnum
CREATE TYPE "WebhookStatus" AS ENUM ('RECEIVED', 'PROCESSING', 'PROCESSED', 'FAILED', 'IGNORED');

-- CreateEnum
CREATE TYPE "OptOutScope" AS ENUM ('MARKETING', 'ALL');

-- CreateEnum
CREATE TYPE "AutomationTriggerType" AS ENUM ('KEYWORD', 'INCOMING_MESSAGE', 'TAG_ADDED', 'MANUAL');

-- CreateEnum
CREATE TYPE "AutomationActionType" AS ENUM ('SEND_TEMPLATE', 'SEND_TEXT', 'ADD_TAG', 'REMOVE_TAG', 'SET_OPT_OUT');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'AGENT',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "failedLogins" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "sessionToken" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "expires" TIMESTAMP(3) NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Contact" (
    "id" TEXT NOT NULL,
    "name" TEXT,
    "phoneE164" TEXT NOT NULL,
    "phoneCountry" TEXT,
    "email" TEXT,
    "source" TEXT,
    "optInStatus" "OptInStatus" NOT NULL DEFAULT 'UNKNOWN',
    "optInAt" TIMESTAMP(3),
    "optInSource" TEXT,
    "marketingOptOut" BOOLEAN NOT NULL DEFAULT false,
    "marketingOptOutAt" TIMESTAMP(3),
    "whatsappStatus" "WhatsAppStatus" NOT NULL DEFAULT 'UNKNOWN',
    "lastContactedAt" TIMESTAMP(3),
    "lastInboundAt" TIMESTAMP(3),
    "attributes" JSONB,
    "notes" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Contact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Tag" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "color" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Tag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContactTag" (
    "contactId" TEXT NOT NULL,
    "tagId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "addedById" TEXT,

    CONSTRAINT "ContactTag_pkey" PRIMARY KEY ("contactId","tagId")
);

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL,
    "metaTemplateId" TEXT,
    "name" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "category" "TemplateCategory" NOT NULL,
    "status" "TemplateStatus" NOT NULL DEFAULT 'DRAFT',
    "components" JSONB NOT NULL,
    "variableCount" INTEGER NOT NULL DEFAULT 0,
    "variableNames" JSONB,
    "qualityScore" TEXT,
    "rejectedReason" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Campaign" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "CampaignStatus" NOT NULL DEFAULT 'DRAFT',
    "idempotencyKey" TEXT NOT NULL,
    "templateId" TEXT,
    "templateName" TEXT NOT NULL,
    "templateLanguage" TEXT NOT NULL,
    "templateCategory" "TemplateCategory" NOT NULL,
    "audienceType" "AudienceType" NOT NULL,
    "audienceFilter" JSONB NOT NULL,
    "variableMapping" JSONB NOT NULL,
    "scheduledAt" TIMESTAMP(3),
    "timezone" TEXT NOT NULL DEFAULT 'Asia/Kolkata',
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "cancelledAt" TIMESTAMP(3),
    "totalRecipients" INTEGER NOT NULL DEFAULT 0,
    "sentCount" INTEGER NOT NULL DEFAULT 0,
    "deliveredCount" INTEGER NOT NULL DEFAULT 0,
    "readCount" INTEGER NOT NULL DEFAULT 0,
    "failedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "repliedCount" INTEGER NOT NULL DEFAULT 0,
    "estimatedCost" DECIMAL(12,4),
    "actualCost" DECIMAL(12,4),
    "currency" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Campaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CampaignRecipient" (
    "id" TEXT NOT NULL,
    "campaignId" TEXT NOT NULL,
    "contactId" TEXT,
    "phoneE164" TEXT NOT NULL,
    "name" TEXT,
    "variables" JSONB NOT NULL,
    "status" "RecipientStatus" NOT NULL DEFAULT 'PENDING',
    "skipReason" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "needsReconciliation" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CampaignRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "contactId" TEXT NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
    "lastMessageAt" TIMESTAMP(3),
    "lastInboundAt" TIMESTAMP(3),
    "lastOutboundAt" TIMESTAMP(3),
    "unreadCount" INTEGER NOT NULL DEFAULT 0,
    "assignedToId" TEXT,
    "serviceWindowExpiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "wamid" TEXT,
    "direction" "MessageDirection" NOT NULL,
    "contactId" TEXT NOT NULL,
    "conversationId" TEXT,
    "campaignRecipientId" TEXT,
    "templateId" TEXT,
    "sentById" TEXT,
    "type" TEXT NOT NULL,
    "body" TEXT,
    "payload" JSONB NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'QUEUED',
    "errorCode" TEXT,
    "errorTitle" TEXT,
    "errorDetail" TEXT,
    "errorUserMessage" TEXT,
    "pricingCategory" TEXT,
    "billable" BOOLEAN,
    "estimatedCost" DECIMAL(12,6),
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEvent" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "wamid" TEXT,
    "payload" JSONB NOT NULL,
    "signatureValid" BOOLEAN NOT NULL,
    "status" "WebhookStatus" NOT NULL DEFAULT 'RECEIVED',
    "error" TEXT,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),

    CONSTRAINT "WebhookEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OptOut" (
    "id" TEXT NOT NULL,
    "contactId" TEXT,
    "phoneE164" TEXT NOT NULL,
    "scope" "OptOutScope" NOT NULL DEFAULT 'MARKETING',
    "reason" TEXT,
    "keyword" TEXT,
    "sourceMessageId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OptOut_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Automation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "runCount" INTEGER NOT NULL DEFAULT 0,
    "lastRunAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Automation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationTrigger" (
    "id" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "type" "AutomationTriggerType" NOT NULL,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationTrigger_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationAction" (
    "id" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "type" "AutomationActionType" NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "templateId" TEXT,
    "tagId" TEXT,
    "config" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationAction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AutomationRun" (
    "id" TEXT NOT NULL,
    "automationId" TEXT NOT NULL,
    "contactId" TEXT,
    "triggerKey" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AutomationRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "actorEmail" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "metadata" JSONB,
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" TEXT,
    "valueEnc" BYTEA,
    "isSecret" BOOLEAN NOT NULL DEFAULT false,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "PricingRate" (
    "id" TEXT NOT NULL,
    "countryCode" TEXT NOT NULL,
    "category" "TemplateCategory" NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "ratePerMessage" DECIMAL(12,6) NOT NULL,
    "tierMinVolume" INTEGER,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "note" TEXT,

    CONSTRAINT "PricingRate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'PENDING',
    "totalRows" INTEGER NOT NULL DEFAULT 0,
    "createdCount" INTEGER NOT NULL DEFAULT 0,
    "updatedCount" INTEGER NOT NULL DEFAULT 0,
    "skippedCount" INTEGER NOT NULL DEFAULT 0,
    "errorCount" INTEGER NOT NULL DEFAULT 0,
    "errorReport" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_isActive_idx" ON "User"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Session_sessionToken_key" ON "Session"("sessionToken");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expires_idx" ON "Session"("expires");

-- CreateIndex
CREATE UNIQUE INDEX "Contact_phoneE164_key" ON "Contact"("phoneE164");

-- CreateIndex
CREATE INDEX "Contact_phoneE164_idx" ON "Contact"("phoneE164");

-- CreateIndex
CREATE INDEX "Contact_createdAt_idx" ON "Contact"("createdAt");

-- CreateIndex
CREATE INDEX "Contact_lastContactedAt_idx" ON "Contact"("lastContactedAt");

-- CreateIndex
CREATE INDEX "Contact_optInStatus_marketingOptOut_idx" ON "Contact"("optInStatus", "marketingOptOut");

-- CreateIndex
CREATE INDEX "Contact_deletedAt_idx" ON "Contact"("deletedAt");

-- CreateIndex
CREATE INDEX "Contact_name_idx" ON "Contact"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_name_key" ON "Tag"("name");

-- CreateIndex
CREATE UNIQUE INDEX "Tag_slug_key" ON "Tag"("slug");

-- CreateIndex
CREATE INDEX "Tag_slug_idx" ON "Tag"("slug");

-- CreateIndex
CREATE INDEX "ContactTag_tagId_idx" ON "ContactTag"("tagId");

-- CreateIndex
CREATE UNIQUE INDEX "Template_metaTemplateId_key" ON "Template"("metaTemplateId");

-- CreateIndex
CREATE INDEX "Template_status_idx" ON "Template"("status");

-- CreateIndex
CREATE INDEX "Template_category_idx" ON "Template"("category");

-- CreateIndex
CREATE INDEX "Template_metaTemplateId_idx" ON "Template"("metaTemplateId");

-- CreateIndex
CREATE UNIQUE INDEX "Template_name_language_key" ON "Template"("name", "language");

-- CreateIndex
CREATE UNIQUE INDEX "Campaign_idempotencyKey_key" ON "Campaign"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Campaign_status_idx" ON "Campaign"("status");

-- CreateIndex
CREATE INDEX "Campaign_createdAt_idx" ON "Campaign"("createdAt");

-- CreateIndex
CREATE INDEX "Campaign_scheduledAt_idx" ON "Campaign"("scheduledAt");

-- CreateIndex
CREATE INDEX "Campaign_status_scheduledAt_idx" ON "Campaign"("status", "scheduledAt");

-- CreateIndex
CREATE INDEX "Campaign_createdById_idx" ON "Campaign"("createdById");

-- CreateIndex
CREATE INDEX "CampaignRecipient_campaignId_status_idx" ON "CampaignRecipient"("campaignId", "status");

-- CreateIndex
CREATE INDEX "CampaignRecipient_status_idx" ON "CampaignRecipient"("status");

-- CreateIndex
CREATE INDEX "CampaignRecipient_phoneE164_idx" ON "CampaignRecipient"("phoneE164");

-- CreateIndex
CREATE INDEX "CampaignRecipient_needsReconciliation_idx" ON "CampaignRecipient"("needsReconciliation");

-- CreateIndex
CREATE UNIQUE INDEX "CampaignRecipient_campaignId_phoneE164_key" ON "CampaignRecipient"("campaignId", "phoneE164");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_contactId_key" ON "Conversation"("contactId");

-- CreateIndex
CREATE INDEX "Conversation_status_lastMessageAt_idx" ON "Conversation"("status", "lastMessageAt");

-- CreateIndex
CREATE INDEX "Conversation_lastMessageAt_idx" ON "Conversation"("lastMessageAt");

-- CreateIndex
CREATE INDEX "Conversation_assignedToId_idx" ON "Conversation"("assignedToId");

-- CreateIndex
CREATE INDEX "Conversation_unreadCount_idx" ON "Conversation"("unreadCount");

-- CreateIndex
CREATE UNIQUE INDEX "Message_wamid_key" ON "Message"("wamid");

-- CreateIndex
CREATE UNIQUE INDEX "Message_campaignRecipientId_key" ON "Message"("campaignRecipientId");

-- CreateIndex
CREATE INDEX "Message_wamid_idx" ON "Message"("wamid");

-- CreateIndex
CREATE INDEX "Message_contactId_createdAt_idx" ON "Message"("contactId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "Message_status_idx" ON "Message"("status");

-- CreateIndex
CREATE INDEX "Message_createdAt_idx" ON "Message"("createdAt");

-- CreateIndex
CREATE INDEX "Message_direction_createdAt_idx" ON "Message"("direction", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WebhookEvent_dedupeKey_key" ON "WebhookEvent"("dedupeKey");

-- CreateIndex
CREATE INDEX "WebhookEvent_status_receivedAt_idx" ON "WebhookEvent"("status", "receivedAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_wamid_idx" ON "WebhookEvent"("wamid");

-- CreateIndex
CREATE INDEX "WebhookEvent_receivedAt_idx" ON "WebhookEvent"("receivedAt");

-- CreateIndex
CREATE INDEX "WebhookEvent_eventType_idx" ON "WebhookEvent"("eventType");

-- CreateIndex
CREATE INDEX "OptOut_phoneE164_idx" ON "OptOut"("phoneE164");

-- CreateIndex
CREATE INDEX "OptOut_createdAt_idx" ON "OptOut"("createdAt");

-- CreateIndex
CREATE INDEX "Automation_isActive_idx" ON "Automation"("isActive");

-- CreateIndex
CREATE INDEX "AutomationTrigger_automationId_idx" ON "AutomationTrigger"("automationId");

-- CreateIndex
CREATE INDEX "AutomationTrigger_type_idx" ON "AutomationTrigger"("type");

-- CreateIndex
CREATE INDEX "AutomationAction_automationId_order_idx" ON "AutomationAction"("automationId", "order");

-- CreateIndex
CREATE INDEX "AutomationRun_automationId_createdAt_idx" ON "AutomationRun"("automationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "AutomationRun_automationId_triggerKey_key" ON "AutomationRun"("automationId", "triggerKey");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_createdAt_idx" ON "AuditLog"("actorUserId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "PricingRate_countryCode_category_idx" ON "PricingRate"("countryCode", "category");

-- CreateIndex
CREATE UNIQUE INDEX "PricingRate_countryCode_category_tierMinVolume_effectiveFro_key" ON "PricingRate"("countryCode", "category", "tierMinVolume", "effectiveFrom");

-- CreateIndex
CREATE INDEX "ImportJob_status_createdAt_idx" ON "ImportJob"("status", "createdAt");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactTag" ADD CONSTRAINT "ContactTag_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContactTag" ADD CONSTRAINT "ContactTag_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_campaignId_fkey" FOREIGN KEY ("campaignId") REFERENCES "Campaign"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CampaignRecipient" ADD CONSTRAINT "CampaignRecipient_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_campaignRecipientId_fkey" FOREIGN KEY ("campaignRecipientId") REFERENCES "CampaignRecipient"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_sentById_fkey" FOREIGN KEY ("sentById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OptOut" ADD CONSTRAINT "OptOut_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Automation" ADD CONSTRAINT "Automation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationTrigger" ADD CONSTRAINT "AutomationTrigger_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationAction" ADD CONSTRAINT "AutomationAction_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationAction" ADD CONSTRAINT "AutomationAction_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationAction" ADD CONSTRAINT "AutomationAction_tagId_fkey" FOREIGN KEY ("tagId") REFERENCES "Tag"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_automationId_fkey" FOREIGN KEY ("automationId") REFERENCES "Automation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AutomationRun" ADD CONSTRAINT "AutomationRun_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
