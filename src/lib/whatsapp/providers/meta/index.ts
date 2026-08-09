import { createHmac, timingSafeEqual } from "node:crypto";

import { moduleLogger } from "@/lib/logger";
import type { MetaConfig } from "@/lib/settings";

import type { WhatsAppProvider } from "../../provider";
import type {
  BusinessAccountProfile,
  CreateTemplateInput,
  NormalisedWebhookEvent,
  Paginated,
  PhoneNumberProfile,
  ProviderTemplate,
  SendMediaInput,
  SendResult,
  SendTemplateInput,
  SendTextInput,
} from "../../types";
import { MetaClient } from "./client";
import {
  buildTemplateComponents,
  parseMetaWebhook,
  toProviderTemplate,
  toRecipient,
  type MetaTemplate,
} from "./mappers";

const log = moduleLogger("meta-provider");

interface SendResponse {
  messages?: Array<{ id?: string }>;
}

interface TemplateListResponse {
  data?: MetaTemplate[];
  paging?: { cursors?: { after?: string }; next?: string };
}

/**
 * Meta WhatsApp Cloud API provider.
 *
 * Official Graph API only — no scraping, no WhatsApp Web automation, no
 * unofficial endpoints. Every path here corresponds to a documented Meta
 * endpoint.
 */
export class MetaCloudProvider implements WhatsAppProvider {
  readonly name = "meta-cloud";

  private readonly client: MetaClient;

  constructor(
    private readonly config: MetaConfig,
    private readonly appSecret?: string,
  ) {
    this.client = new MetaClient(config);
  }

  /* ---------------------------------------------------------------- */
  /* Sending                                                           */
  /* ---------------------------------------------------------------- */

  private async send(body: Record<string, unknown>): Promise<SendResult> {
    const result = await this.client.request<SendResponse>(
      `${this.config.phoneNumberId}/messages`,
      { method: "POST", body },
    );

    if (result.ok === true) {
      const externalMessageId = result.data.messages?.[0]?.id;

      if (!externalMessageId) {
        // A 200 with no message ID should not happen; treating it as accepted
        // would leave a message we can never match a status webhook to.
        log.error({ data: result.data }, "Meta accepted a send but returned no message id");
        return {
          accepted: false,
          error: {
            code: "no_message_id",
            retryable: false,
            userMessage: "WhatsApp accepted the message but did not confirm it.",
            technicalDetail: JSON.stringify(result.data),
          },
        };
      }

      return { accepted: true, externalMessageId };
    }

    if (result.ok === "unknown") {
      return { accepted: "unknown", error: result.error };
    }

    return { accepted: false, error: result.error };
  }

  async sendTemplateMessage(input: SendTemplateInput): Promise<SendResult> {
    const components = buildTemplateComponents(
      input.bodyVariables,
      input.headerVariables,
    );

    return this.send({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: toRecipient(input.to),
      type: "template",
      template: {
        name: input.templateName,
        language: { code: input.languageCode },
        ...(components.length ? { components } : {}),
      },
    });
  }

  async sendTextMessage(input: SendTextInput): Promise<SendResult> {
    return this.send({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: toRecipient(input.to),
      type: "text",
      text: { preview_url: input.previewUrl ?? false, body: input.body },
    });
  }

  async sendMediaMessage(input: SendMediaInput): Promise<SendResult> {
    return this.send({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: toRecipient(input.to),
      type: input.type,
      [input.type]: {
        link: input.link,
        ...(input.caption ? { caption: input.caption } : {}),
        ...(input.filename ? { filename: input.filename } : {}),
      },
    });
  }

  async markMessageAsRead(externalMessageId: string): Promise<boolean> {
    const result = await this.client.request(
      `${this.config.phoneNumberId}/messages`,
      {
        method: "POST",
        body: {
          messaging_product: "whatsapp",
          status: "read",
          message_id: externalMessageId,
        },
      },
    );

    return result.ok === true;
  }

  /* ---------------------------------------------------------------- */
  /* Templates                                                         */
  /* ---------------------------------------------------------------- */

  async getTemplates(cursor?: string): Promise<Paginated<ProviderTemplate>> {
    const result = await this.client.request<TemplateListResponse>(
      `${this.config.wabaId}/message_templates`,
      {
        query: {
          limit: "100",
          after: cursor,
          fields:
            "id,name,language,category,status,components,quality_score,rejected_reason",
        },
      },
    );

    if (result.ok !== true) {
      throw new Error(result.error.userMessage);
    }

    return {
      items: (result.data.data ?? []).map(toProviderTemplate),
      nextCursor: result.data.paging?.next
        ? result.data.paging.cursors?.after
        : undefined,
    };
  }

  async createTemplate(input: CreateTemplateInput): Promise<ProviderTemplate> {
    const result = await this.client.request<MetaTemplate>(
      `${this.config.wabaId}/message_templates`,
      {
        method: "POST",
        body: {
          name: input.name,
          language: input.language,
          category: input.category,
          components: input.components,
        },
      },
    );

    if (result.ok !== true) {
      throw new Error(result.error.userMessage);
    }

    return toProviderTemplate({
      ...result.data,
      name: result.data.name ?? input.name,
      language: result.data.language ?? input.language,
      category: result.data.category ?? input.category,
      status: result.data.status ?? "PENDING",
      components: input.components,
    });
  }

  /* ---------------------------------------------------------------- */
  /* Account                                                           */
  /* ---------------------------------------------------------------- */

  async getPhoneNumber(): Promise<PhoneNumberProfile | null> {
    const result = await this.client.request<{
      id?: string;
      display_phone_number?: string;
      verified_name?: string;
      quality_rating?: string;
      messaging_limit_tier?: string;
    }>(this.config.phoneNumberId, {
      query: {
        fields:
          "id,display_phone_number,verified_name,quality_rating,messaging_limit_tier",
      },
    });

    if (result.ok !== true) return null;

    return {
      id: result.data.id ?? this.config.phoneNumberId,
      displayPhoneNumber: result.data.display_phone_number ?? "",
      verifiedName: result.data.verified_name ?? "",
      qualityRating: result.data.quality_rating,
      messagingLimitTier: result.data.messaging_limit_tier,
    };
  }

  async getBusinessAccount(): Promise<BusinessAccountProfile | null> {
    const result = await this.client.request<{
      id?: string;
      name?: string;
      timezone_id?: string;
      message_template_namespace?: string;
    }>(this.config.wabaId, {
      query: { fields: "id,name,timezone_id,message_template_namespace" },
    });

    if (result.ok !== true) return null;

    return {
      id: result.data.id ?? this.config.wabaId,
      name: result.data.name ?? "",
      timezoneId: result.data.timezone_id,
      messageTemplateNamespace: result.data.message_template_namespace,
    };
  }

  /* ---------------------------------------------------------------- */
  /* Webhooks                                                          */
  /* ---------------------------------------------------------------- */

  /**
   * Verifies X-Hub-Signature-256 over the RAW request bytes.
   *
   * Parsing and re-serialising the body changes the bytes and breaks the
   * signature, so the caller must pass exactly what arrived on the wire.
   * Returns false when no App Secret is configured — an unverifiable request
   * is never treated as authentic.
   */
  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string): boolean {
    if (!this.appSecret) {
      log.error("Webhook signature check attempted without an App Secret");
      return false;
    }

    if (!signatureHeader?.startsWith("sha256=")) return false;

    const expected = createHmac("sha256", this.appSecret)
      .update(rawBody)
      .digest("hex");

    const received = signatureHeader.slice("sha256=".length);

    const a = Buffer.from(expected, "utf8");
    const b = Buffer.from(received, "utf8");
    if (a.length !== b.length) return false;

    return timingSafeEqual(a, b);
  }

  parseWebhook(payload: unknown): NormalisedWebhookEvent[] {
    return parseMetaWebhook(payload);
  }
}
