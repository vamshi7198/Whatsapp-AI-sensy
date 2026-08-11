import type { Prisma } from "@prisma/client";

import { prisma } from "../db";
import { getServiceWindow } from "../inbox/service";
import { maskPhone, moduleLogger } from "../logger";
import { getProvider } from "../whatsapp";

const log = moduleLogger("automations");

/**
 * Automatic replies to incoming messages.
 *
 * Everything here messages real customers without a human looking, so it is
 * built to under-react rather than over-react:
 *
 *  - Automations are created switched OFF. Nothing runs until someone turns it
 *    on deliberately.
 *  - Each inbound message fires a given automation at most once, enforced by a
 *    unique key in the database rather than by hoping the webhook arrives once.
 *  - A customer who just asked to stop hearing from us gets no auto-reply.
 *  - Only the first matching automation replies. Two overlapping keyword rules
 *    send one message, not two.
 *  - Free-text replies are only possible inside the 24-hour window, which an
 *    inbound message has by definition just opened.
 */

export interface KeywordConfig {
  /** Words that trigger this, already trimmed. */
  keywords: string[];
  /** Whole message must equal a keyword, rather than merely contain one. */
  matchType: "exact" | "contains";
}

export interface TextActionConfig {
  body: string;
}

/** Reads the trigger config JSON without trusting its shape. */
function asKeywordConfig(value: Prisma.JsonValue): KeywordConfig {
  const raw = (value ?? {}) as Record<string, unknown>;
  const keywords = Array.isArray(raw.keywords)
    ? raw.keywords.filter((k): k is string => typeof k === "string")
    : [];

  return {
    keywords,
    matchType: raw.matchType === "contains" ? "contains" : "exact",
  };
}

function asTextConfig(value: Prisma.JsonValue): TextActionConfig {
  const raw = (value ?? {}) as Record<string, unknown>;
  return { body: typeof raw.body === "string" ? raw.body : "" };
}

/** Does this message trigger this keyword rule? */
export function matchesKeyword(text: string, config: KeywordConfig): boolean {
  const message = text.trim().toLowerCase();
  if (!message) return false;

  return config.keywords.some((keyword) => {
    const needle = keyword.trim().toLowerCase();
    if (!needle) return false;

    if (config.matchType === "exact") {
      // Trailing punctuation is not a different word: "track." is "track".
      return message.replace(/[.!?]+$/, "") === needle;
    }

    // Word boundaries, so "track" does not fire on "backtrack".
    return new RegExp(
      `(^|\\W)${needle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|\\W)`,
    ).test(message);
  });
}

export interface InboundContext {
  contactId: string;
  phoneE164: string;
  text: string | null;
  /** The WhatsApp message id — used to make each trigger fire exactly once. */
  externalMessageId: string;
  conversationId: string;
  lastInboundAt: Date;
}

/**
 * Runs whatever should happen when a customer sends a message.
 *
 * Failures are contained per automation: one broken rule must not stop the
 * others, and must never stop the message itself being stored.
 */
export async function runAutomationsForInbound(
  context: InboundContext,
): Promise<void> {
  const active = await prisma.automation.findMany({
    where: {
      isActive: true,
      triggers: { some: { type: { in: ["KEYWORD", "INCOMING_MESSAGE"] } } },
    },
    include: {
      triggers: true,
      actions: { orderBy: { order: "asc" }, include: { template: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  if (active.length === 0) return;

  // Someone who has just asked to stop hearing from us must not be answered by
  // a robot. The opt-out is applied before this runs, so the flag is current.
  const contact = await prisma.contact.findUnique({
    where: { id: context.contactId },
    select: { marketingOptOut: true, deletedAt: true },
  });

  if (contact?.deletedAt) return;

  for (const automation of active) {
    const triggered = automation.triggers.some((trigger) => {
      if (trigger.type === "INCOMING_MESSAGE") return true;
      if (trigger.type !== "KEYWORD") return false;
      if (!context.text) return false;
      return matchesKeyword(context.text, asKeywordConfig(trigger.config));
    });

    if (!triggered) continue;

    // Claim this message for this automation. The unique constraint is what
    // makes a retried webhook safe: the second attempt cannot create the row,
    // so the customer is not messaged twice.
    try {
      await prisma.automationRun.create({
        data: {
          automationId: automation.id,
          contactId: context.contactId,
          triggerKey: context.externalMessageId,
          status: "RUNNING",
        },
      });
    } catch {
      log.debug(
        { automationId: automation.id, wamid: context.externalMessageId },
        "Automation already ran for this message",
      );
      continue;
    }

    try {
      await runActions(automation.id, automation.actions, context, {
        optedOut: contact?.marketingOptOut ?? false,
      });

      await prisma.$transaction([
        prisma.automationRun.update({
          where: {
            automationId_triggerKey: {
              automationId: automation.id,
              triggerKey: context.externalMessageId,
            },
          },
          data: { status: "COMPLETED" },
        }),
        prisma.automation.update({
          where: { id: automation.id },
          data: { runCount: { increment: 1 }, lastRunAt: new Date() },
        }),
      ]);

      log.info(
        { automationId: automation.id, name: automation.name },
        "Automation ran",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);

      await prisma.automationRun
        .update({
          where: {
            automationId_triggerKey: {
              automationId: automation.id,
              triggerKey: context.externalMessageId,
            },
          },
          data: { status: "FAILED", error: message },
        })
        .catch(() => undefined);

      log.error(
        { automationId: automation.id, err: message },
        "Automation failed",
      );
    }

    // Only the first matching automation replies. Two overlapping keyword
    // rules should send one message, not two.
    return;
  }
}

type ActionRow = Prisma.AutomationActionGetPayload<{
  include: { template: true };
}>;

async function runActions(
  automationId: string,
  actions: ActionRow[],
  context: InboundContext,
  flags: { optedOut: boolean },
): Promise<void> {
  for (const action of actions) {
    switch (action.type) {
      case "ADD_TAG":
        if (action.tagId) {
          await prisma.contactTag.createMany({
            data: [{ contactId: context.contactId, tagId: action.tagId }],
            skipDuplicates: true,
          });
        }
        break;

      case "REMOVE_TAG":
        if (action.tagId) {
          await prisma.contactTag.deleteMany({
            where: { contactId: context.contactId, tagId: action.tagId },
          });
        }
        break;

      case "SET_OPT_OUT":
        await prisma.contact.update({
          where: { id: context.contactId },
          data: {
            marketingOptOut: true,
            marketingOptOutAt: new Date(),
            optInStatus: "OPTED_OUT",
          },
        });
        break;

      case "SEND_TEXT":
        await sendAutoText(automationId, context, asTextConfig(action.config));
        break;

      case "SEND_TEMPLATE":
        await sendAutoTemplate(automationId, action, context, flags);
        break;
    }
  }
}

/**
 * Sends a plain reply.
 *
 * Free of charge and needs no template approval, because it goes out inside
 * the 24-hour window the customer's own message just opened. The window is
 * re-checked rather than assumed: a webhook delayed by more than a day would
 * otherwise produce a send Meta rejects.
 */
async function sendAutoText(
  automationId: string,
  context: InboundContext,
  config: TextActionConfig,
): Promise<void> {
  if (!config.body.trim()) return;

  const window = getServiceWindow(context.lastInboundAt);
  if (!window.open) {
    throw new Error(
      "The 24-hour reply window had closed by the time this ran, so no message was sent.",
    );
  }

  const provider = await getProvider();
  if (!provider) throw new Error("WhatsApp is not connected.");

  const result = await provider.sendTextMessage({
    to: context.phoneE164,
    body: config.body,
  });

  if (result.accepted === false) {
    throw new Error(result.error.userMessage);
  }

  const now = new Date();

  await prisma.$transaction([
    prisma.message.create({
      data: {
        wamid: result.accepted === true ? result.externalMessageId : null,
        direction: "OUTBOUND",
        contactId: context.contactId,
        conversationId: context.conversationId,
        type: "text",
        body: config.body,
        payload: { automationId } as Prisma.InputJsonValue,
        status: "SENT",
        sentAt: now,
      },
    }),
    prisma.conversation.update({
      where: { id: context.conversationId },
      data: { lastMessageAt: now, lastOutboundAt: now },
    }),
  ]);

  log.info(
    { to: maskPhone(context.phoneE164), automationId },
    "Auto-reply sent",
  );
}

/**
 * Sends an approved template.
 *
 * Unlike a plain reply this costs money, and a marketing template must not go
 * to someone who has opted out — the same rule campaigns follow.
 */
async function sendAutoTemplate(
  automationId: string,
  action: ActionRow,
  context: InboundContext,
  flags: { optedOut: boolean },
): Promise<void> {
  const template = action.template;
  if (!template) throw new Error("The template for this automation was deleted.");

  if (template.status !== "APPROVED") {
    throw new Error(
      "That template is no longer approved by WhatsApp, so it was not sent.",
    );
  }

  if (template.category === "MARKETING" && flags.optedOut) {
    log.info(
      { automationId, contactId: context.contactId },
      "Skipped a marketing template: contact has opted out",
    );
    return;
  }

  const provider = await getProvider();
  if (!provider) throw new Error("WhatsApp is not connected.");

  const result = await provider.sendTemplateMessage({
    to: context.phoneE164,
    templateName: template.name,
    languageCode: template.language,
    bodyVariables: {},
  });

  if (result.accepted === false) {
    throw new Error(result.error.userMessage);
  }

  const now = new Date();

  await prisma.$transaction([
    prisma.message.create({
      data: {
        wamid: result.accepted === true ? result.externalMessageId : null,
        direction: "OUTBOUND",
        contactId: context.contactId,
        conversationId: context.conversationId,
        templateId: template.id,
        type: "template",
        payload: { automationId } as Prisma.InputJsonValue,
        status: "SENT",
        sentAt: now,
      },
    }),
    prisma.conversation.update({
      where: { id: context.conversationId },
      data: { lastMessageAt: now, lastOutboundAt: now },
    }),
    prisma.contact.update({
      where: { id: context.contactId },
      data: { lastContactedAt: now },
    }),
  ]);

  log.info(
    { to: maskPhone(context.phoneE164), automationId, template: template.name },
    "Auto-reply template sent",
  );
}
