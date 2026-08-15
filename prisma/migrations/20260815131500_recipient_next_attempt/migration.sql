-- Lets a retry be scheduled rather than slept through.
--
-- A retryable send used to call setTimeout inline, inside the loop that walks
-- a batch of 50 recipients, inside the scheduler pass. The backoff runs 5s,
-- 10s, 20s, 40s, so one batch of retrying recipients could hold the pass for
-- over half an hour.
--
-- Nothing else in that pass runs meanwhile: journey WAIT steps do not fire,
-- stored-but-unapplied webhooks are not recovered, and the heartbeat that
-- /api/health reads is not written -- so the one signal that reveals a dead
-- scheduler reads "stalled" during a perfectly normal send, which teaches
-- whoever watches it to ignore the alarm that matters.
--
-- With a due time on the row the send loop can simply skip that recipient and
-- come back to them on a later pass.

ALTER TABLE "CampaignRecipient" ADD COLUMN "nextAttemptAt" TIMESTAMP(3);

-- The send query filters on (campaignId, status) and now also on this, so it
-- rides along on the existing composite rather than needing its own scan.
CREATE INDEX "CampaignRecipient_campaignId_status_nextAttemptAt_idx"
  ON "CampaignRecipient" ("campaignId", "status", "nextAttemptAt");
