-- Lets a contact go through a journey again once the last one has ended.
--
-- The old index was UNIQUE on ("journeyId","contactId") with no predicate, so
-- it enforced "once, ever" while the comment above it said "once at a time".
-- A contact who finished a journey, or whose session ended in FAILED after a
-- transient Meta error, could never be entered again -- re-running a sampling
-- journey next quarter would silently reach nobody who took part the first
-- time, and every temporary fault became a permanent ban.
--
-- The predicate below is the difference: only an in-flight session blocks a
-- new one. HANDED_OFF counts as in-flight deliberately -- a human is holding
-- that conversation and the bot must not start talking over them.
--
-- NOTE FOR FUTURE MIGRATIONS: Prisma cannot express a partial unique index in
-- schema.prisma, so this index is not visible to the schema and `prisma
-- migrate dev` will try to DROP it. If that ever appears in a generated
-- migration, delete the drop. scripts/test-journey-reentry.ts asserts the
-- index is present and will fail if it goes missing.

DROP INDEX "JourneySession_journeyId_contactId_key";

CREATE UNIQUE INDEX "JourneySession_journeyId_contactId_active_key"
  ON "JourneySession" ("journeyId", "contactId")
  WHERE status IN ('ACTIVE', 'WAITING_FOR_REPLY', 'WAITING_UNTIL', 'HANDED_OFF');

-- The lookups that used to ride on the unique index still need an index.
CREATE INDEX "JourneySession_journeyId_contactId_idx"
  ON "JourneySession" ("journeyId", "contactId");
