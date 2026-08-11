import { randomBytes } from "node:crypto";

import type { Prisma } from "@prisma/client";

import { prisma } from "../db";
import { getServiceWindow } from "../inbox/service";
import { moduleLogger } from "../logger";
import { getMetaConfig } from "../settings";
import { getProvider } from "../whatsapp";
import { MetaClient } from "../whatsapp/providers/meta/client";
import {
  MetaFlowsApi,
  type FlowCategory,
} from "../whatsapp/providers/meta/flows";
import {
  buildFlowJson,
  FLOW_JSON_VERSION,
  validateFlow,
  type FlowDefinition,
} from "./builder";

const log = moduleLogger("flows");

export interface FlowResult {
  ok: boolean;
  flowId?: string;
  error?: string;
  /** Problems with the form itself, one per line, for showing inline. */
  validationErrors?: string[];
}

/** Builds the Meta API wrapper, or null when WhatsApp is not connected. */
async function flowsApi(): Promise<{
  api: MetaFlowsApi;
  apiVersion: string;
  accessToken: string;
} | null> {
  const config = await getMetaConfig();
  if (!config) return null;

  return {
    api: new MetaFlowsApi(new MetaClient(config), config.wabaId),
    apiVersion: config.apiVersion,
    accessToken: config.accessToken,
  };
}

/**
 * Creates a form as a draft, at Meta and here.
 *
 * Left as a draft on purpose. A draft can be opened, filled in and thrown
 * away; publishing is irreversible, so it is a separate deliberate step.
 */
export async function createFlow(input: {
  definition: FlowDefinition;
  category: FlowCategory;
  createdById: string;
  /** Set when this supersedes an existing form. */
  family?: string;
}): Promise<FlowResult> {
  const validation = validateFlow(input.definition);
  if (!validation.ok) {
    return { ok: false, validationErrors: validation.errors };
  }

  const connection = await flowsApi();
  if (!connection) {
    return { ok: false, error: "WhatsApp is not connected yet." };
  }

  // A title of only punctuation would slugify to nothing, hence the fallback.
  const slug =
    input.definition.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "form";

  const family = input.family ?? slug;

  // Versions count up within a family, so the history of one logical form
  // stays readable after Meta forces a new flow for every change.
  const previous = await prisma.flow.findFirst({
    where: { family },
    orderBy: { version: "desc" },
    select: { version: true },
  });

  const version = (previous?.version ?? 0) + 1;
  const metaName = `${family}-v${version}`;

  const created = await connection.api.create({
    name: metaName,
    categories: [input.category],
  });

  if (!created.ok || !created.flowId) {
    return { ok: false, error: created.error };
  }

  const flowJson = buildFlowJson(input.definition);

  const uploaded = await connection.api.setFlowJson(
    created.flowId,
    flowJson,
    connection.apiVersion,
    connection.accessToken,
  );

  if (!uploaded.ok) {
    // Clean up rather than leave an empty draft behind. A draft with no
    // screens is not usable and would only confuse whoever finds it.
    await connection.api.deleteDraft(created.flowId).catch(() => undefined);
    return { ok: false, error: uploaded.error };
  }

  const flow = await prisma.flow.create({
    data: {
      externalFlowId: created.flowId,
      name: input.definition.title,
      family,
      version,
      status: "DRAFT",
      category: input.category,
      flowJson: flowJson as Prisma.InputJsonValue,
      jsonVersion: FLOW_JSON_VERSION,
      createdById: input.createdById,
    },
    select: { id: true },
  });

  log.info(
    { flowId: flow.id, externalFlowId: created.flowId, family, version },
    "Flow created as a draft",
  );

  return { ok: true, flowId: flow.id };
}

/**
 * Publishes a draft.
 *
 * Irreversible at Meta: a published flow cannot be edited or deleted, only
 * retired. The UI says so before anyone gets here.
 */
export async function publishFlow(id: string): Promise<FlowResult> {
  const flow = await prisma.flow.findUnique({
    where: { id },
    select: { externalFlowId: true, status: true, name: true },
  });

  if (!flow) return { ok: false, error: "That form no longer exists." };
  if (!flow.externalFlowId) {
    return { ok: false, error: "That form was never created at WhatsApp." };
  }

  if (flow.status !== "DRAFT") {
    return { ok: false, error: "Only a draft can be published." };
  }

  const connection = await flowsApi();
  if (!connection) {
    return { ok: false, error: "WhatsApp is not connected yet." };
  }

  const result = await connection.api.publish(flow.externalFlowId);
  if (!result.ok) return { ok: false, error: result.error };

  await prisma.flow.update({
    where: { id },
    data: { status: "PUBLISHED", publishedAt: new Date() },
  });

  log.info({ flowId: id, name: flow.name }, "Flow published");
  return { ok: true, flowId: id };
}

/** Retires a published form. The only way to withdraw one. */
export async function deprecateFlow(id: string): Promise<FlowResult> {
  const flow = await prisma.flow.findUnique({
    where: { id },
    select: { externalFlowId: true, status: true },
  });

  if (!flow?.externalFlowId) {
    return { ok: false, error: "That form no longer exists." };
  }

  const connection = await flowsApi();
  if (!connection) {
    return { ok: false, error: "WhatsApp is not connected yet." };
  }

  // A draft is deleted outright; only a published flow needs deprecating.
  const result =
    flow.status === "DRAFT"
      ? await connection.api.deleteDraft(flow.externalFlowId)
      : await connection.api.deprecate(flow.externalFlowId);

  if (!result.ok) return { ok: false, error: result.error };

  if (flow.status === "DRAFT") {
    await prisma.flow.delete({ where: { id } });
  } else {
    await prisma.flow.update({
      where: { id },
      data: { status: "DEPRECATED", deprecatedAt: new Date() },
    });
  }

  return { ok: true };
}

/**
 * Records that a form was sent, and returns the token to send with it.
 *
 * The token is the only thing tying a response back to a person: Meta echoes
 * it back but does not include the form's id. It is random rather than
 * derived, so a customer cannot guess another's token and submit as them.
 */
export async function recordFlowSend(input: {
  flowId: string;
  contactId: string;
  campaignId?: string;
}): Promise<{ token: string; sendId: string }> {
  const token = randomBytes(24).toString("base64url");

  const send = await prisma.flowSend.create({
    data: {
      flowId: input.flowId,
      contactId: input.contactId,
      campaignId: input.campaignId,
      token,
    },
    select: { id: true },
  });

  return { token, sendId: send.id };
}

/**
 * Files a completed form against the send that produced it.
 *
 * A response whose token we do not recognise is still stored, with no send
 * attached. A real customer filled that in, and discarding it because our
 * record is missing would lose their answers permanently.
 */
export async function recordFlowResponse(input: {
  token?: string;
  contactId: string;
  answers: Record<string, unknown>;
  wamid?: string;
}): Promise<{ stored: boolean; matched: boolean }> {
  const send = input.token
    ? await prisma.flowSend.findUnique({
        where: { token: input.token },
        select: { id: true, flowId: true, contactId: true, answeredAt: true },
      })
    : null;

  if (!send) {
    log.warn(
      { hasToken: Boolean(input.token) },
      "Form response with no matching send — storing it unattached",
    );

    // With no send there is no flow to attach it to either, so the answers
    // are kept on the message itself, which the webhook already stored.
    return { stored: false, matched: false };
  }

  // Meta retries webhooks, and a customer can be sent the same form twice.
  // The first answer is the one kept.
  if (send.answeredAt) {
    log.debug({ sendId: send.id }, "Form already answered — ignoring repeat");
    return { stored: true, matched: true };
  }

  await prisma.$transaction([
    prisma.flowResponse.create({
      data: {
        flowId: send.flowId,
        sendId: send.id,
        contactId: send.contactId,
        answers: input.answers as Prisma.InputJsonValue,
        wamid: input.wamid,
      },
    }),
    prisma.flowSend.update({
      where: { id: send.id },
      data: { answeredAt: new Date() },
    }),
  ]);

  log.info({ sendId: send.id, flowId: send.flowId }, "Form response recorded");
  return { stored: true, matched: true };
}

/**
 * Sends a form to one person, inside their 24-hour window.
 *
 * The send is recorded BEFORE the message goes out. If it were recorded
 * afterwards and the process died in between, the customer would receive a
 * form whose answers could never be attributed to them — and unlike a lost
 * message, that cannot be recovered by any retry.
 */
export async function sendFlowToContact(input: {
  flowId: string;
  contactId: string;
  body: string;
  buttonText: string;
  campaignId?: string;
}): Promise<{ ok: boolean; error?: string; wamid?: string }> {
  const [flow, contact] = await Promise.all([
    prisma.flow.findUnique({
      where: { id: input.flowId },
      select: { externalFlowId: true, status: true, name: true },
    }),
    prisma.contact.findUnique({
      where: { id: input.contactId },
      select: {
        phoneE164: true,
        deletedAt: true,
        conversation: { select: { lastInboundAt: true } },
      },
    }),
  ]);

  if (!flow?.externalFlowId) return { ok: false, error: "That form no longer exists." };
  if (flow.status === "DEPRECATED") {
    return { ok: false, error: "That form has been retired and cannot be sent." };
  }

  if (!contact || contact.deletedAt) {
    return { ok: false, error: "That contact no longer exists." };
  }

  // Checked here rather than trusting the caller: outside the window Meta
  // rejects the message, and the failure counts against the account.
  const window = getServiceWindow(contact.conversation?.lastInboundAt ?? null);
  if (!window.open) {
    return {
      ok: false,
      error:
        "A form can only be sent within 24 hours of the customer's last message. Send an approved template with a form button instead.",
    };
  }

  const provider = await getProvider();
  if (!provider) return { ok: false, error: "WhatsApp is not connected yet." };

  const { token, sendId } = await recordFlowSend({
    flowId: input.flowId,
    contactId: input.contactId,
    campaignId: input.campaignId,
  });

  const result = await provider.sendFlowMessage({
    to: contact.phoneE164,
    externalFlowId: flow.externalFlowId,
    flowToken: token,
    body: input.body,
    buttonText: input.buttonText,
    // A draft opens for testing without publishing, which cannot be undone.
    draft: flow.status === "DRAFT",
  });

  if (result.accepted === false) {
    // The send never happened, so the record of it is noise that would show
    // up as an unanswered form forever.
    await prisma.flowSend.delete({ where: { id: sendId } }).catch(() => undefined);
    return { ok: false, error: result.error.userMessage };
  }

  const wamid = result.accepted === true ? result.externalMessageId : undefined;

  if (wamid) {
    await prisma.flowSend.update({ where: { id: sendId }, data: { wamid } });
  }

  log.info(
    { flowId: input.flowId, sendId, name: flow.name },
    "Form sent",
  );

  return { ok: true, wamid };
}

export async function listFlows() {
  return prisma.flow.findMany({
    where: { status: { not: "DEPRECATED" } },
    orderBy: [{ family: "asc" }, { version: "desc" }],
    include: {
      createdBy: { select: { name: true } },
      _count: { select: { sends: true, responses: true } },
    },
  });
}

export async function getFlowWithResponses(id: string) {
  return prisma.flow.findUnique({
    where: { id },
    include: {
      responses: {
        orderBy: { receivedAt: "desc" },
        take: 200,
        include: {
          contact: { select: { name: true, phoneE164: true } },
        },
      },
      _count: { select: { sends: true, responses: true } },
    },
  });
}
