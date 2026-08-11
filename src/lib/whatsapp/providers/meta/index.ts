import { createHmac, timingSafeEqual } from "node:crypto";

import { moduleLogger } from "@/lib/logger";
import type { MetaConfig } from "@/lib/settings";

import type { WhatsAppProvider } from "../../provider";
import type {
  BusinessAccountProfile,
  BusinessProfile,
  CreateTemplateInput,
  MediaUploadResult,
  NormalisedWebhookEvent,
  Paginated,
  PhoneNumberProfile,
  ProviderTemplate,
  SendFlowInput,
  SendMediaInput,
  SendResult,
  SendTemplateInput,
  SendTextInput,
  UpdateBusinessProfileInput,
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
    /** Needed only for resumable uploads, which run against the app node. */
    private readonly appId?: string,
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

    // A media header is its own component and must come first, ahead of the
    // body — Meta matches components positionally against the template.
    if (input.headerMedia) {
      const { type, link, id, filename } = input.headerMedia;

      components.unshift({
        type: "header",
        parameters: [
          {
            type,
            [type]: {
              ...(link ? { link } : {}),
              ...(id ? { id } : {}),
              ...(filename && type === "document" ? { filename } : {}),
            },
          },
        ],
      });
    }

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

  /**
   * Sends an in-chat form.
   *
   * Only works inside the 24-hour window the customer's own message opened.
   * Outside it Meta will not deliver a raw interactive message at all, and the
   * form has to travel on an approved template with a flow button instead —
   * which is a different call, and a template review.
   *
   * flowToken is ours and comes back untouched on the response. Meta defaults
   * it to the literal string "unused" when omitted, which would make every
   * response indistinguishable, so it is required here rather than optional.
   */
  async sendFlowMessage(input: SendFlowInput): Promise<SendResult> {
    return this.send({
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: toRecipient(input.to),
      type: "interactive",
      interactive: {
        type: "flow",
        ...(input.header ? { header: { type: "text", text: input.header } } : {}),
        body: { text: input.body },
        ...(input.footer ? { footer: { text: input.footer } } : {}),
        action: {
          name: "flow",
          parameters: {
            // Meta requires the string "3" here. It is the version of the
            // flow MESSAGE, unrelated to the Flow JSON version.
            flow_message_version: "3",
            flow_token: input.flowToken,
            flow_id: input.externalFlowId,
            flow_cta: input.buttonText,
            // A draft can be opened for testing before anything is published,
            // which matters because publishing cannot be undone.
            mode: input.draft ? "draft" : "published",
            flow_action: "navigate",
            flow_action_payload: { screen: "FORM" },
          },
        },
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
  /* Business profile                                                  */
  /* ---------------------------------------------------------------- */

  async getBusinessProfile(): Promise<BusinessProfile | null> {
    const result = await this.client.request<{
      data?: Array<{
        about?: string;
        address?: string;
        description?: string;
        email?: string;
        websites?: string[];
        vertical?: string;
        profile_picture_url?: string;
      }>;
    }>(`${this.config.phoneNumberId}/whatsapp_business_profile`, {
      query: {
        fields:
          "about,address,description,email,profile_picture_url,websites,vertical",
      },
    });

    if (result.ok !== true) return null;

    const profile = result.data.data?.[0];
    if (!profile) return {};

    return {
      about: profile.about,
      address: profile.address,
      description: profile.description,
      email: profile.email,
      websites: profile.websites,
      vertical: profile.vertical,
      profilePictureUrl: profile.profile_picture_url,
    };
  }

  async updateBusinessProfile(
    input: UpdateBusinessProfileInput,
  ): Promise<boolean> {
    // Only send the fields being changed. Passing an empty string would
    // clear a value the user never intended to touch.
    const body: Record<string, unknown> = { messaging_product: "whatsapp" };

    if (input.about !== undefined) body.about = input.about;
    if (input.address !== undefined) body.address = input.address;
    if (input.description !== undefined) body.description = input.description;
    if (input.email !== undefined) body.email = input.email;
    if (input.vertical !== undefined) body.vertical = input.vertical;
    if (input.websites !== undefined) body.websites = input.websites;
    if (input.profilePictureHandle !== undefined) {
      body.profile_picture_handle = input.profilePictureHandle;
    }

    const result = await this.client.request(
      `${this.config.phoneNumberId}/whatsapp_business_profile`,
      { method: "POST", body },
    );

    return result.ok === true;
  }

  /* ---------------------------------------------------------------- */
  /* Uploads                                                           */
  /* ---------------------------------------------------------------- */

  /**
   * Uploads an image for the profile picture.
   *
   * This uses the resumable upload API, which is a separate two-step flow
   * from the media API used for messages, and returns a file *handle* rather
   * than a media id. The two are not interchangeable.
   */
  async uploadProfilePicture(
    bytes: Buffer,
    mimeType: string,
  ): Promise<string | null> {
    if (!this.appId) {
      log.error("Cannot upload a profile picture without META_APP_ID");
      return null;
    }

    // Step 1: open a session against the app, not the phone number.
    const sessionUrl =
      `https://graph.facebook.com/${this.config.apiVersion}/${this.appId}/uploads` +
      `?file_length=${bytes.length}&file_type=${encodeURIComponent(mimeType)}`;

    const sessionResponse = await fetch(sessionUrl, {
      method: "POST",
      headers: { Authorization: `Bearer ${this.config.accessToken}` },
    });

    const session = (await sessionResponse.json()) as {
      id?: string;
      error?: { message?: string };
    };

    if (!session.id) {
      log.error({ err: session.error?.message }, "Could not start the upload");
      return null;
    }

    // Step 2: send the bytes. file_offset 0 because we never resume — these
    // are profile pictures, not large files.
    const uploadResponse = await fetch(
      `https://graph.facebook.com/${this.config.apiVersion}/${session.id}`,
      {
        method: "POST",
        headers: {
          Authorization: `OAuth ${this.config.accessToken}`,
          file_offset: "0",
          "Content-Type": mimeType,
        },
        body: new Uint8Array(bytes),
      },
    );

    const uploaded = (await uploadResponse.json()) as {
      h?: string;
      error?: { message?: string };
    };

    if (!uploaded.h) {
      log.error({ err: uploaded.error?.message }, "Upload failed");
      return null;
    }

    return uploaded.h;
  }

  /**
   * Uploads media for sending in a message.
   *
   * Returns a media id, which Meta expires after roughly a week — fine for a
   * one-off campaign, not for a template meant to be reused.
   */
  async uploadMedia(
    bytes: Buffer,
    mimeType: string,
    filename: string,
  ): Promise<MediaUploadResult | null> {
    const form = new FormData();
    form.append("messaging_product", "whatsapp");
    form.append("type", mimeType);
    form.append(
      "file",
      new Blob([new Uint8Array(bytes)], { type: mimeType }),
      filename,
    );

    const response = await fetch(
      `https://graph.facebook.com/${this.config.apiVersion}/${this.config.phoneNumberId}/media`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${this.config.accessToken}` },
        body: form,
      },
    );

    const body = (await response.json()) as {
      id?: string;
      error?: { message?: string };
    };

    if (!body.id) {
      log.error({ err: body.error?.message }, "Media upload failed");
      return null;
    }

    return { id: body.id };
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
