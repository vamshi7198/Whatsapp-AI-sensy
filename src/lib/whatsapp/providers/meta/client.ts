import type { MetaConfig } from "@/lib/settings";
import { moduleLogger } from "@/lib/logger";

import { classifyError, LOCAL_ERRORS } from "../../errors";
import { isPreConnectFailure } from "./network";
import type { NormalisedError } from "../../types";

const log = moduleLogger("meta-client");

const GRAPH_BASE = "https://graph.facebook.com";
const DEFAULT_TIMEOUT_MS = 30_000;

export interface MetaErrorBody {
  error?: {
    message?: string;
    type?: string;
    code?: number;
    error_subcode?: number;
    error_data?: { details?: string };
    fbtrace_id?: string;
  };
}

export type MetaResponse<T> =
  | { ok: true; data: T }
  | { ok: false; error: NormalisedError }
  /**
   * The request was written but no response arrived. Whether Meta accepted it
   * is unknowable, so callers must not retry blindly.
   */
  | { ok: "unknown"; error: NormalisedError };

/**
 * HTTP client for the Meta Graph API.
 *
 * Responsibilities kept here so no other file has to know about Meta's wire
 * format: authentication, timeouts, error classification, and redacted
 * logging. The access token is never logged — only its presence.
 */
export class MetaClient {
  constructor(private readonly config: MetaConfig) {}

  private url(path: string): string {
    return `${GRAPH_BASE}/${this.config.apiVersion}/${path}`;
  }

  async request<T>(
    path: string,
    init: {
      method?: "GET" | "POST" | "DELETE";
      body?: unknown;
      query?: Record<string, string | undefined>;
      timeoutMs?: number;
    } = {},
  ): Promise<MetaResponse<T>> {
    const method = init.method ?? "GET";
    const query = new URLSearchParams();

    for (const [key, value] of Object.entries(init.query ?? {})) {
      if (value !== undefined) query.set(key, value);
    }

    const url = `${this.url(path)}${query.size ? `?${query}` : ""}`;
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      init.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    );

    const started = Date.now();

    try {
      const response = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.config.accessToken}`,
          "Content-Type": "application/json",
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
        signal: controller.signal,
      });

      const text = await response.text();
      const durationMs = Date.now() - started;

      let parsed: unknown;
      try {
        parsed = text ? JSON.parse(text) : {};
      } catch {
        log.error(
          { path, status: response.status, durationMs },
          "Meta returned a non-JSON response",
        );

        // A 2xx we cannot read is ambiguous, not a failure.
        //
        // Meta answered with success and we simply could not parse it — a
        // captive-portal interstitial served with status 200 is entirely
        // plausible on home broadband. Recording that as FAILED meant the
        // recipient was then copied into a resend campaign and messaged
        // again, duplicating a message that had very likely been delivered.
        if (response.ok && method === "POST") {
          return { ok: "unknown", error: { ...LOCAL_ERRORS.NETWORK } };
        }

        return {
          ok: false,
          error: classifyError(
            undefined,
            "Unexpected response format",
            response.status,
          ),
        };
      }

      if (!response.ok) {
        const body = parsed as MetaErrorBody;
        const code = body.error?.error_subcode || body.error?.code;
        const detail =
          body.error?.error_data?.details ?? body.error?.message ?? text;

        log.warn(
          {
            path,
            method,
            status: response.status,
            code,
            fbtrace: body.error?.fbtrace_id,
            durationMs,
          },
          "Meta API returned an error",
        );

        return {
          ok: false,
          error: classifyError(code, detail, response.status),
        };
      }

      log.debug({ path, method, durationMs }, "Meta API call succeeded");
      return { ok: true, data: parsed as T };
    } catch (error) {
      const durationMs = Date.now() - started;
      const isAbort = error instanceof Error && error.name === "AbortError";

      log.error(
        {
          path,
          method,
          durationMs,
          err: error instanceof Error ? error.message : String(error),
        },
        isAbort ? "Meta API call timed out" : "Meta API call failed",
      );

      // A timeout on a POST is genuinely ambiguous — the message may well have
      // been accepted. GETs are safe to treat as plain failures.
      if (isAbort && method === "POST") {
        return { ok: "unknown", error: { ...LOCAL_ERRORS.TIMEOUT } };
      }

      // So is a connection that died after the request went out.
      //
      // Only the timeout used to be treated as ambiguous. A socket reset
      // surfaces from fetch as a TypeError carrying cause.code ECONNRESET, so
      // it fell through to a plain retryable failure and the message was sent
      // again — up to five times, with no idempotency key reaching Meta,
      // because SendTemplateInput.idempotencyKey is declared but never set or
      // read. Meta may well have accepted the first one.
      //
      // Not every network error though: if the connection was never
      // established, nothing was sent and retrying is exactly right. Calling
      // those ambiguous would strand recipients as phantom sends over an
      // ordinary DNS blip.
      if (method === "POST" && !isPreConnectFailure(error)) {
        return { ok: "unknown", error: { ...LOCAL_ERRORS.NETWORK } };
      }

      return {
        ok: false,
        error: isAbort
          ? { ...LOCAL_ERRORS.TIMEOUT }
          : { ...LOCAL_ERRORS.NETWORK },
      };
    } finally {
      clearTimeout(timeout);
    }
  }
}
