import type { Prisma } from "@prisma/client";

import { prisma } from "../db";
import { moduleLogger } from "../logger";

const log = moduleLogger("automations");

export interface CreateAutomationInput {
  name: string;
  /** Empty means "reply to every message", which the UI states plainly. */
  keywords: string[];
  matchType: "exact" | "contains";
  reply:
    | { kind: "text"; body: string }
    | { kind: "template"; templateId: string };
  createdById: string;
}

export interface AutomationResult {
  ok: boolean;
  automationId?: string;
  error?: string;
}

/**
 * Creates an auto-reply, switched OFF.
 *
 * Off is not a default worth changing. Turning it on messages real customers
 * without anyone watching, so that has to be a separate, deliberate act after
 * the wording has been read back.
 */
export async function createAutomation(
  input: CreateAutomationInput,
): Promise<AutomationResult> {
  const name = input.name.trim();
  if (!name) return { ok: false, error: "Give this automation a name." };

  const keywords = input.keywords
    .map((k) => k.trim())
    .filter(Boolean)
    .slice(0, 25);

  if (input.reply.kind === "text") {
    const body = input.reply.body.trim();

    if (!body) return { ok: false, error: "Write the reply to send." };
    if (body.length > 4096) {
      return { ok: false, error: "That reply is too long for WhatsApp." };
    }
  }

  if (input.reply.kind === "template") {
    const template = await prisma.template.findUnique({
      where: { id: input.reply.templateId },
      select: { status: true, variableCount: true },
    });

    if (!template) return { ok: false, error: "That template no longer exists." };

    if (template.status !== "APPROVED") {
      return {
        ok: false,
        error: "That template is not approved by WhatsApp, so it cannot be sent.",
      };
    }

    // An auto-reply has no campaign behind it to supply values, so a template
    // with blanks in it would fail for every customer.
    if (template.variableCount > 0) {
      return {
        ok: false,
        error:
          "That template has blanks to fill in, which an automatic reply cannot do. Choose a template with no blanks, or write the reply out instead.",
      };
    }
  }

  const automation = await prisma.automation.create({
    data: {
      name,
      isActive: false,
      createdById: input.createdById,
      triggers: {
        create: [
          keywords.length > 0
            ? {
                type: "KEYWORD" as const,
                config: {
                  keywords,
                  matchType: input.matchType,
                } as Prisma.InputJsonValue,
              }
            : { type: "INCOMING_MESSAGE" as const, config: {} },
        ],
      },
      actions: {
        create: [
          input.reply.kind === "text"
            ? {
                type: "SEND_TEXT" as const,
                order: 0,
                config: { body: input.reply.body.trim() } as Prisma.InputJsonValue,
              }
            : {
                type: "SEND_TEMPLATE" as const,
                order: 0,
                templateId: input.reply.templateId,
                config: {},
              },
        ],
      },
    },
    select: { id: true },
  });

  log.info({ automationId: automation.id, name }, "Automation created");
  return { ok: true, automationId: automation.id };
}

export async function listAutomations() {
  return prisma.automation.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      triggers: true,
      actions: { orderBy: { order: "asc" }, include: { template: true } },
      createdBy: { select: { name: true } },
      _count: { select: { runs: true } },
    },
  });
}

/** Turns an automation on or off. */
export async function setAutomationActive(
  id: string,
  isActive: boolean,
): Promise<void> {
  await prisma.automation.update({ where: { id }, data: { isActive } });
  log.info({ automationId: id, isActive }, "Automation toggled");
}

export async function deleteAutomation(id: string): Promise<void> {
  await prisma.automation.delete({ where: { id } });
  log.info({ automationId: id }, "Automation deleted");
}

/** Recent runs, for showing what an automation has actually been doing. */
export async function getRecentRuns(limit = 20) {
  return prisma.automationRun.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
    include: {
      automation: { select: { name: true } },
      contact: { select: { name: true, phoneE164: true } },
    },
  });
}
