import type { MetaClient } from "./client";

/**
 * WhatsApp Flows — in-chat forms.
 *
 * Two facts from Meta's documentation shape everything here:
 *
 *  1. A PUBLISHED flow can never be edited or deleted. Deprecating it is the
 *     only way out. So changing a form means creating and publishing a new
 *     one, and callers must treat a published flow id as permanent.
 *
 *  2. A flow response does not say which flow it came from. Correlation is
 *     entirely through a token we generate when sending and Meta echoes back.
 *
 * These calls also need whatsapp_business_management on the token, which the
 * message-sending calls do not. Without it they fail with a permissions error
 * that reads like a bug — scripts/check-flows-access.ts reports on that.
 */

/** Meta's own categories. At least one is required when creating a flow. */
export const FLOW_CATEGORIES = [
  "SIGN_UP",
  "SIGN_IN",
  "APPOINTMENT_BOOKING",
  "LEAD_GENERATION",
  "CONTACT_US",
  "CUSTOMER_SUPPORT",
  "SURVEY",
  "OTHER",
] as const;

export type FlowCategory = (typeof FLOW_CATEGORIES)[number];

export interface FlowSummary {
  id: string;
  name: string;
  status: string;
  categories: string[];
  validationErrors?: Array<{ error?: string; message?: string }>;
}

export interface FlowOperationResult {
  ok: boolean;
  flowId?: string;
  /** Plain-English explanation, safe to show an operator. */
  error?: string;
  /** Meta's validation detail, for the technical view. */
  validationErrors?: Array<{
    error?: string;
    error_type?: string;
    message?: string;
    line_start?: number;
    column_start?: number;
  }>;
}

interface MetaFlowError {
  error?: string;
  error_type?: string;
  message?: string;
  line_start?: number;
  column_start?: number;
}

export class MetaFlowsApi {
  constructor(
    private readonly client: MetaClient,
    private readonly wabaId: string,
  ) {}

  /** Every flow on the account. */
  async list(): Promise<FlowSummary[]> {
    const result = await this.client.request<{
      data?: Array<{
        id?: string;
        name?: string;
        status?: string;
        categories?: string[];
      }>;
    }>(`${this.wabaId}/flows`);

    if (result.ok !== true) return [];

    return (result.data.data ?? [])
      .filter((f): f is { id: string } & typeof f => Boolean(f.id))
      .map((f) => ({
        id: f.id,
        name: f.name ?? f.id,
        status: f.status ?? "UNKNOWN",
        categories: f.categories ?? [],
      }));
  }

  /**
   * Creates a flow as a DRAFT.
   *
   * Deliberately never publishes in the same call. A draft can be tested end
   * to end and then deleted if wrong; a published flow is permanent.
   */
  async create(input: {
    name: string;
    categories: FlowCategory[];
  }): Promise<FlowOperationResult> {
    const result = await this.client.request<{ id?: string }>(
      `${this.wabaId}/flows`,
      {
        method: "POST",
        body: { name: input.name, categories: input.categories },
      },
    );

    if (result.ok !== true) {
      return { ok: false, error: result.error.userMessage };
    }

    if (!result.data.id) {
      return { ok: false, error: "WhatsApp did not return an id for the form." };
    }

    return { ok: true, flowId: result.data.id };
  }

  /**
   * Uploads the screen definition.
   *
   * A separate endpoint from updating the flow's name and categories: the JSON
   * is an asset, not a field, and it goes as multipart rather than JSON —
   * which is why this bypasses the normal client and builds the request here.
   */
  async setFlowJson(
    flowId: string,
    flowJson: unknown,
    apiVersion: string,
    accessToken: string,
  ): Promise<FlowOperationResult> {
    const form = new FormData();
    form.set("name", "flow.json");
    form.set("asset_type", "FLOW_JSON");
    form.set(
      "file",
      new Blob([JSON.stringify(flowJson)], { type: "application/json" }),
      "flow.json",
    );

    const response = await fetch(
      `https://graph.facebook.com/${apiVersion}/${flowId}/assets`,
      {
        method: "POST",
        // No Content-Type header: fetch sets the multipart boundary itself,
        // and overriding it produces a request Meta cannot parse.
        headers: { Authorization: `Bearer ${accessToken}` },
        body: form,
      },
    );

    const body = (await response.json().catch(() => ({}))) as {
      success?: boolean;
      validation_errors?: MetaFlowError[];
      error?: { message?: string };
    };

    if (body.validation_errors?.length) {
      return {
        ok: false,
        error: describeValidationErrors(body.validation_errors),
        validationErrors: body.validation_errors,
      };
    }

    if (!response.ok || body.error) {
      return {
        ok: false,
        error: body.error?.message ?? "WhatsApp rejected the form definition.",
      };
    }

    return { ok: true, flowId };
  }

  /**
   * Publishes a draft, permanently.
   *
   * After this the flow cannot be changed or deleted — only deprecated — so
   * callers should have tested it in draft mode first.
   */
  async publish(flowId: string): Promise<FlowOperationResult> {
    const result = await this.client.request<{ success?: boolean }>(
      `${flowId}/publish`,
      { method: "POST" },
    );

    if (result.ok !== true) {
      return { ok: false, error: result.error.userMessage };
    }

    return { ok: true, flowId };
  }

  /** Retires a published flow. The only way to withdraw one. */
  async deprecate(flowId: string): Promise<FlowOperationResult> {
    const result = await this.client.request<{ success?: boolean }>(
      `${flowId}/deprecate`,
      { method: "POST" },
    );

    if (result.ok !== true) {
      return { ok: false, error: result.error.userMessage };
    }

    return { ok: true, flowId };
  }

  /** Deletes a draft. Meta refuses this once a flow is published. */
  async deleteDraft(flowId: string): Promise<FlowOperationResult> {
    const result = await this.client.request<{ success?: boolean }>(flowId, {
      method: "DELETE",
    });

    if (result.ok !== true) {
      return { ok: false, error: result.error.userMessage };
    }

    return { ok: true };
  }
}

/** Turns Meta's validation errors into something an operator can act on. */
function describeValidationErrors(errors: MetaFlowError[]): string {
  const first = errors[0];
  const detail = first?.message ?? first?.error ?? "it was not valid";

  const where =
    first?.line_start !== undefined ? ` (line ${first.line_start})` : "";

  return errors.length > 1
    ? `WhatsApp rejected the form: ${detail}${where}, and ${errors.length - 1} other problem${errors.length === 2 ? "" : "s"}.`
    : `WhatsApp rejected the form: ${detail}${where}.`;
}
