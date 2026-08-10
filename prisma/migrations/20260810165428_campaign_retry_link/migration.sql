-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "retryOfCampaignId" TEXT;

-- CreateIndex
CREATE INDEX "Campaign_retryOfCampaignId_idx" ON "Campaign"("retryOfCampaignId");

-- AddForeignKey
ALTER TABLE "Campaign" ADD CONSTRAINT "Campaign_retryOfCampaignId_fkey" FOREIGN KEY ("retryOfCampaignId") REFERENCES "Campaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
