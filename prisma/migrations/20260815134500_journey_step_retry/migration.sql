-- Lets a session wait to RETRY a step, as distinct from waiting ON one.
--
-- resumeDueSessions treats WAITING_UNTIL as "sitting on a WAIT step" and moves
-- past it before running on. That is right for a wait, and exactly wrong for a
-- step that failed and needs another go: without this column the resume would
-- skip the failed step and carry on as though it had sent, so the customer
-- would silently never receive that message.
--
-- Set to the step being retried, cleared the moment it succeeds or the session
-- gives up.

ALTER TABLE "JourneySession" ADD COLUMN "retryingStepId" TEXT;
