import type { Prisma } from "@prisma/client";

import { prisma } from "../db";
import { moduleLogger } from "../logger";
import { matchesKeyword } from "../automations/engine";
import { startJourney } from "./engine";

const log = moduleLogger("journeys");

/**
 * Deciding whether an incoming message should start a journey.
 *
 * The triggers existed in the schema from the beginning and nothing evaluated
 * them, so a journey could only ever be started by hand. This is what makes
 * "message SAMPLE and the conversation begins" actually happen.
 *
 * Order matters and is deliberate. Someone already in a journey is handled by
 * that journey — this only runs when they are not. And keyword triggers are
 * tried before catch-alls, so a specific word wins over a rule that answers
 * everything.
 */

interface TriggerContext {
  contactId: string;
  text: string | null;
  /** The WhatsApp message id, so a retried webhook cannot start two journeys. */
  externalId: string;
}

interface KeywordTriggerConfig {
  keywords: string[];
  matchType: "exact" | "contains";
}

function readKeywords(config: Prisma.JsonValue): KeywordTriggerConfig {
  const raw =
    config && typeof config === "object" && !Array.isArray(config)
      ? (config as Record<string, unknown>)
      : {};

  return {
    keywords: Array.isArray(raw.keywords)
      ? raw.keywords.filter((k): k is string => typeof k === "string")
      : [],
    matchType: raw.matchType === "exact" ? "exact" : "contains",
  };
}

/**
 * Starts a journey if this message triggers one.
 *
 * Returns true when a journey was started, so the caller can skip keyword
 * auto-replies — otherwise a customer who says "sample" gets both a journey
 * and an automation talking over each other.
 */
export async function startJourneyFromMessage(
  context: TriggerContext,
): Promise<boolean> {
  // Somebody already partway through is that journey's business, not a
  // candidate for starting another.
  const existing = await prisma.journeySession.findFirst({
    where: {
      contactId: context.contactId,
      status: { in: ["ACTIVE", "WAITING_FOR_REPLY", "WAITING_UNTIL"] },
    },
    select: { id: true },
  });

  if (existing) return false;

  const triggers = await prisma.journeyTrigger.findMany({
    where: {
      isActive: true,
      type: { in: ["KEYWORD", "ANY_MESSAGE"] },
      // Only triggers belonging to the version customers actually enter, on a
      // journey that has not been switched off. A trigger left on an old draft
      // must not quietly keep working.
      version: {
        status: "PUBLISHED",
        journey: { isActive: true, archivedAt: null },
      },
    },
    select: {
      type: true,
      config: true,
      version: { select: { journeyId: true, journey: { select: { name: true } } } },
    },
  });

  if (triggers.length === 0) return false;

  // Specific before general, so a catch-all cannot swallow a keyword.
  const keywordFirst = [
    ...triggers.filter((t) => t.type === "KEYWORD"),
    ...triggers.filter((t) => t.type === "ANY_MESSAGE"),
  ];

  for (const trigger of keywordFirst) {
    if (trigger.type === "KEYWORD") {
      if (!context.text) continue;
      if (!matchesKeyword(context.text, readKeywords(trigger.config))) continue;
    }

    const started = await startJourney({
      journeyId: trigger.version.journeyId,
      contactId: context.contactId,
      trigger:
        trigger.type === "KEYWORD"
          ? `keyword: ${context.text?.slice(0, 40)}`
          : "any message",
    });

    if (started.ok) {
      log.info(
        {
          journeyId: trigger.version.journeyId,
          name: trigger.version.journey.name,
          type: trigger.type,
        },
        "Journey started by a message",
      );
      return true;
    }

    // Could not start — already in it, unpublished, no start step. Try the
    // next trigger rather than giving up on the message entirely.
    log.debug(
      { journeyId: trigger.version.journeyId, reason: started.error },
      "Trigger matched but the journey did not start",
    );
  }

  return false;
}

/**
 * Starts journeys triggered by a tag being added.
 *
 * Called wherever a tag is applied. Kept separate from the message path
 * because it has no inbound message behind it and therefore no 24-hour
 * window — such a journey must open with a template.
 */
export async function startJourneysForTag(
  contactId: string,
  tagId: string,
): Promise<number> {
  const triggers = await prisma.journeyTrigger.findMany({
    where: {
      isActive: true,
      type: "TAG_ADDED",
      version: {
        status: "PUBLISHED",
        journey: { isActive: true, archivedAt: null },
      },
    },
    select: {
      config: true,
      version: { select: { journeyId: true } },
    },
  });

  let started = 0;

  for (const trigger of triggers) {
    const config =
      trigger.config && typeof trigger.config === "object"
        ? (trigger.config as Record<string, unknown>)
        : {};

    if (config.tagId !== tagId) continue;

    const result = await startJourney({
      journeyId: trigger.version.journeyId,
      contactId,
      trigger: "tag added",
    });

    if (result.ok) started += 1;
  }

  return started;
}
