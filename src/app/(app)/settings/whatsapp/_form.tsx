"use client";

import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";

import {
  disconnectWhatsApp,
  saveWhatsAppSettings,
  testConnection,
  type WhatsAppSettingsState,
} from "./actions";

interface Initial {
  wabaId: string;
  phoneNumberId: string;
  apiVersion: string;
  tokenIsSet: boolean;
  tokenMasked: string | null;
  lastConnectionOk: string | null;
  qualityRating: string | null;
  messagingTier: string | null;
  appSecretConfigured: boolean;
  webhookUrl: string;
  verifyTokenConfigured: boolean;
}

function qualityTone(rating: string | null): "green" | "amber" | "red" | "neutral" {
  switch (rating?.toUpperCase()) {
    case "GREEN":
      return "green";
    case "YELLOW":
      return "amber";
    case "RED":
      return "red";
    default:
      return "neutral";
  }
}

export function WhatsAppSettingsForm({ initial }: { initial: Initial }) {
  const [state, setState] = useState<WhatsAppSettingsState>({});
  const [isPending, startTransition] = useTransition();
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
          WhatsApp connection
        </h2>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
          These details come from your Meta developer account. Only
          administrators can see or change them.
        </p>
      </div>

      {state.error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {state.error}
        </div>
      )}

      {state.success && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
          {state.success}
        </div>
      )}

      {state.connection && (
        <div
          className={
            state.connection.ok
              ? "rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950"
              : "rounded-xl border border-red-200 bg-red-50 p-4 dark:border-red-900 dark:bg-red-950"
          }
        >
          <p
            className={
              state.connection.ok
                ? "text-sm font-medium text-emerald-900 dark:text-emerald-200"
                : "text-sm font-medium text-red-900 dark:text-red-200"
            }
          >
            {state.connection.ok ? "✓ " : "✕ "}
            {state.connection.message}
          </p>

          {state.connection.ok && (
            <dl className="mt-2 space-y-1 text-sm text-emerald-800 dark:text-emerald-300">
              {state.connection.businessName && (
                <div className="flex gap-2">
                  <dt className="w-32 shrink-0">Business</dt>
                  <dd>{state.connection.businessName}</dd>
                </div>
              )}
              {state.connection.phoneNumber && (
                <div className="flex gap-2">
                  <dt className="w-32 shrink-0">Number</dt>
                  <dd>
                    {state.connection.phoneNumber}
                    {state.connection.verifiedName &&
                      ` (${state.connection.verifiedName})`}
                  </dd>
                </div>
              )}
              {state.connection.qualityRating && (
                <div className="flex gap-2">
                  <dt className="w-32 shrink-0">Quality</dt>
                  <dd>{state.connection.qualityRating}</dd>
                </div>
              )}
              {state.connection.messagingTier && (
                <div className="flex gap-2">
                  <dt className="w-32 shrink-0">Daily limit</dt>
                  <dd>{state.connection.messagingTier}</dd>
                </div>
              )}
            </dl>
          )}
        </div>
      )}

      {/* Status summary */}
      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 dark:border-slate-800 dark:bg-slate-900">
        <span className="text-sm text-slate-600 dark:text-slate-400">
          Status:
        </span>
        {initial.tokenIsSet ? (
          <Badge tone="green">✓ Access token saved</Badge>
        ) : (
          <Badge tone="amber">No access token yet</Badge>
        )}
        {initial.qualityRating && (
          <Badge tone={qualityTone(initial.qualityRating)}>
            Quality: {initial.qualityRating}
          </Badge>
        )}
        {initial.messagingTier && (
          <Badge tone="blue">{initial.messagingTier}</Badge>
        )}
        {initial.lastConnectionOk && (
          <span className="text-xs text-slate-400">
            Last successful check:{" "}
            {new Intl.DateTimeFormat("en-IN", {
              dateStyle: "medium",
              timeStyle: "short",
              timeZone: "Asia/Kolkata",
            }).format(new Date(initial.lastConnectionOk))}
          </span>
        )}
      </div>

      <form
        action={(formData) => {
          startTransition(async () => {
            setState(await saveWhatsAppSettings({}, formData));
          });
        }}
        className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
      >
        <Field
          label="WhatsApp Business Account ID"
          htmlFor="wabaId"
          hint="numbers only"
        >
          <Input
            id="wabaId"
            name="wabaId"
            defaultValue={initial.wabaId}
            required
            inputMode="numeric"
            placeholder="123456789012345"
          />
          <p className="mt-1 text-xs text-slate-400">
            Meta developer account → your app → WhatsApp → API Setup
          </p>
        </Field>

        <Field label="Phone Number ID" htmlFor="phoneNumberId" hint="numbers only">
          <Input
            id="phoneNumberId"
            name="phoneNumberId"
            defaultValue={initial.phoneNumberId}
            required
            inputMode="numeric"
            placeholder="123456789012345"
          />
          <p className="mt-1 text-xs text-slate-400">
            The long ID shown underneath your phone number — not the phone
            number itself.
          </p>
        </Field>

        <Field label="API version" htmlFor="apiVersion">
          <Input
            id="apiVersion"
            name="apiVersion"
            defaultValue={initial.apiVersion}
            required
            placeholder="v23.0"
            className="max-w-32"
          />
          <p className="mt-1 text-xs text-slate-400">
            Leave as-is unless Meta asks you to change it.
          </p>
        </Field>

        {/* Write-only: the saved token is never sent back to the browser, so
            there is nothing here to steal from the page source. */}
        <Field
          label="Access token"
          htmlFor="accessToken"
          hint={initial.tokenIsSet ? "leave blank to keep the current one" : "required"}
        >
          <Input
            id="accessToken"
            name="accessToken"
            type="password"
            autoComplete="off"
            placeholder={
              initial.tokenIsSet
                ? `Currently saved: ${initial.tokenMasked}`
                : "Paste your System User token"
            }
          />
          <p className="mt-1 text-xs text-slate-400">
            Use a <strong>System User</strong> token from Meta Business Settings
            → Users → System Users. The token shown on the API Setup page
            expires after 24 hours and will stop working every day.
          </p>
        </Field>

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button
            type="button"
            variant="secondary"
            disabled={isPending}
            onClick={() =>
              startTransition(async () => setState(await testConnection()))
            }
          >
            Test connection
          </Button>
          <Button type="submit" disabled={isPending}>
            {isPending ? "Saving…" : "Save settings"}
          </Button>
        </div>
      </form>

      {/* Webhook configuration — read-only, for pasting into Meta. */}
      <section className="rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900">
        <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
          Receiving messages
        </h3>
        <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
          Meta sends incoming messages and delivery updates to this address.
          Paste it into your Meta app under WhatsApp → Configuration.
        </p>

        <div className="mt-3 space-y-2">
          <div>
            <p className="text-xs font-medium text-slate-600 dark:text-slate-400">
              Callback URL
            </p>
            <code className="mt-0.5 block rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs break-all dark:border-slate-700 dark:bg-slate-950">
              {initial.webhookUrl}
            </code>
          </div>

          <div className="flex flex-wrap gap-2 pt-1">
            {initial.appSecretConfigured ? (
              <Badge tone="green">✓ App Secret configured</Badge>
            ) : (
              <Badge tone="red">✕ App Secret missing</Badge>
            )}
            {initial.verifyTokenConfigured ? (
              <Badge tone="green">✓ Verify token configured</Badge>
            ) : (
              <Badge tone="red">✕ Verify token missing</Badge>
            )}
          </div>

          {!initial.appSecretConfigured && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
              Without the App Secret, incoming messages cannot be verified as
              genuine and will be rejected. An administrator must add it to the
              server configuration.
            </p>
          )}

          {initial.webhookUrl.includes("localhost") && (
            <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-300">
              This address points to your own computer, so Meta cannot reach it.
              Incoming messages will only work once this app is running on a
              public web address.
            </p>
          )}
        </div>
      </section>

      {initial.tokenIsSet && (
        <section className="rounded-xl border border-red-200 bg-white p-5 dark:border-red-900 dark:bg-slate-900">
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
            Disconnect WhatsApp
          </h3>
          <p className="mt-0.5 mb-3 text-sm text-slate-500 dark:text-slate-400">
            Removes the saved access token. Campaigns and replies will stop
            working until a new token is saved. Your contacts and history are
            not affected.
          </p>

          {confirmDisconnect ? (
            <div className="flex items-center gap-2">
              <span className="text-sm text-red-700 dark:text-red-400">
                Remove the access token?
              </span>
              <Button
                variant="danger"
                size="sm"
                disabled={isPending}
                onClick={() =>
                  startTransition(async () => {
                    setState(await disconnectWhatsApp());
                    setConfirmDisconnect(false);
                  })
                }
              >
                Yes, disconnect
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setConfirmDisconnect(false)}
              >
                Cancel
              </Button>
            </div>
          ) : (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setConfirmDisconnect(true)}
            >
              Disconnect
            </Button>
          )}
        </section>
      )}
    </div>
  );
}
