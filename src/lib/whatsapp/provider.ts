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
} from "./types";

/**
 * The seam between the application and whichever messaging platform is behind
 * it. Meta is the only implementation today; replacing it later should mean
 * writing one class, not rewriting campaigns, the inbox and automations.
 *
 * Note there is no `getMessageStatus` that calls out to the provider: Meta has
 * no endpoint to fetch the delivery status of a message. Status is push-only,
 * via webhooks, which is why webhook reliability is load-bearing rather than
 * merely nice to have.
 */
export interface WhatsAppProvider {
  readonly name: string;

  sendTemplateMessage(input: SendTemplateInput): Promise<SendResult>;
  sendTextMessage(input: SendTextInput): Promise<SendResult>;
  sendMediaMessage(input: SendMediaInput): Promise<SendResult>;

  /** Sends a read receipt for an inbound message. */
  markMessageAsRead(externalMessageId: string): Promise<boolean>;

  getTemplates(cursor?: string): Promise<Paginated<ProviderTemplate>>;
  createTemplate(input: CreateTemplateInput): Promise<ProviderTemplate>;

  getPhoneNumber(): Promise<PhoneNumberProfile | null>;
  getBusinessAccount(): Promise<BusinessAccountProfile | null>;

  /** Verifies a webhook signature over the raw request bytes. */
  verifyWebhookSignature(rawBody: Buffer, signatureHeader: string): boolean;

  /** Converts a provider webhook payload into domain events. */
  parseWebhook(payload: unknown): NormalisedWebhookEvent[];
}

/** Thrown when a caller reaches the provider before it is configured. */
export class ProviderNotConfiguredError extends Error {
  constructor() {
    super(
      "WhatsApp is not connected. Add your WhatsApp Business details in Settings.",
    );
    this.name = "ProviderNotConfiguredError";
  }
}
