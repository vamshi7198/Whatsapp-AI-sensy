"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { formatNumber } from "@/lib/utils";

import {
  createJourneyAction,
  startForAudienceAction,
  toggleJourneyAction,
  type JourneyState,
} from "./actions";

interface JourneyRow {
  id: string;
  name: string;
  description: string | null;
  isLive: boolean;
  liveVersion: number | null;
  hasDraft: boolean;
  isActive: boolean;
  createdBy: string | null;
  total: number;
  waiting: number;
  completed: number;
  failed: number;
  handedOff: number;
}

export function JourneyList({
  canManage,
  canSend,
  journeys,
  tags,
}: {
  canManage: boolean;
  canSend: boolean;
  journeys: JourneyRow[];
  tags: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const [state, setState] = useState<JourneyState>({});
  const [isPending, startTransition] = useTransition();
  const [creating, setCreating] = useState(false);
  const [sending, setSending] = useState<string | null>(null);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
            Journeys
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            Conversations that answer themselves — a message, some buttons, and
            a different reply for each one.
          </p>
        </div>

        {canManage && !creating && (
          <Button onClick={() => setCreating(true)}>New journey</Button>
        )}
      </div>

      {state.error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {state.error}
        </div>
      )}

      {creating && canManage && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <form
            action={(formData) => {
              startTransition(async () => {
                const result = await createJourneyAction({}, formData);
                setState(result);

                // Straight onto the canvas: the name is not the interesting
                // part, the shape is.
                if (result.journeyId) router.push(`/journeys/${result.journeyId}`);
                else setCreating(false);
              });
            }}
            className="space-y-3"
          >
            <Field label="Name" htmlFor="name" hint="Only you see this.">
              <Input
                id="name"
                name="name"
                required
                maxLength={120}
                placeholder="Pilot sampling"
              />
            </Field>

            <Field label="What is it for?" htmlFor="description">
              <Textarea
                id="description"
                name="description"
                rows={2}
                maxLength={300}
                placeholder="Offer a free sample and find out why people say no."
              />
            </Field>

            <div className="flex gap-2">
              <Button type="submit" disabled={isPending}>
                {isPending ? "Creating…" : "Create and open"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setCreating(false)}
              >
                Cancel
              </Button>
            </div>
          </form>
        </section>
      )}

      {journeys.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-slate-900">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No journeys yet.
          </p>
          <p className="mt-1 text-xs text-slate-400">
            A good first one: offer something, and send a different reply
            depending on the answer.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {journeys.map((journey) => (
            <section
              key={journey.id}
              className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900"
            >
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/journeys/${journey.id}`}
                      className="font-medium text-slate-900 hover:underline dark:text-slate-50"
                    >
                      {journey.name}
                    </Link>

                    <Badge tone={journey.isLive ? "green" : "neutral"}>
                      {journey.isLive ? `Live · v${journey.liveVersion}` : "Draft"}
                    </Badge>

                    {journey.isLive && !journey.isActive && (
                      <Badge tone="amber">Switched off</Badge>
                    )}

                    {journey.isLive && journey.hasDraft && (
                      <Badge tone="amber">Unpublished changes</Badge>
                    )}
                  </div>

                  {journey.description && (
                    <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
                      {journey.description}
                    </p>
                  )}

                  {journey.total > 0 ? (
                    <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">
                      <strong>{formatNumber(journey.total)}</strong> started ·{" "}
                      {formatNumber(journey.completed)} finished ·{" "}
                      {formatNumber(journey.waiting)} waiting
                      {journey.handedOff > 0 &&
                        ` · ${formatNumber(journey.handedOff)} with a person`}
                      {journey.failed > 0 && (
                        <span className="text-red-600 dark:text-red-400">
                          {" "}
                          · {formatNumber(journey.failed)} stopped early
                        </span>
                      )}
                    </p>
                  ) : (
                    <p className="mt-2 text-xs text-slate-400">
                      Nobody has been through this yet.
                    </p>
                  )}

                  {journey.createdBy && (
                    <p className="mt-0.5 text-xs text-slate-400">
                      Built by {journey.createdBy}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 gap-2">
                  {journey.isLive && canManage && (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={isPending}
                      onClick={() => {
                        const formData = new FormData();
                        formData.set("journeyId", journey.id);
                        formData.set("isActive", journey.isActive ? "" : "on");
                        startTransition(async () => {
                          setState(await toggleJourneyAction({}, formData));
                        });
                      }}
                    >
                      {journey.isActive ? "Switch off" : "Switch on"}
                    </Button>
                  )}
                  {journey.isLive && journey.isActive && canSend && (
                    <Button
                      size="sm"
                      onClick={() =>
                        setSending(sending === journey.id ? null : journey.id)
                      }
                    >
                      Send to people
                    </Button>
                  )}
                  {journey.total > 0 && (
                    <Link href={`/journeys/${journey.id}/results`}>
                      <Button variant="secondary" size="sm">
                        Results
                      </Button>
                    </Link>
                  )}
                  {canManage && (
                    <Link href={`/journeys/${journey.id}`}>
                      <Button variant="secondary" size="sm">
                        Edit
                      </Button>
                    </Link>
                  )}
                </div>
              </div>

              {sending === journey.id && (
                <form
                  action={(formData) => {
                    formData.set("journeyId", journey.id);
                    startTransition(async () => {
                      setState(await startForAudienceAction({}, formData));
                      setSending(null);
                    });
                  }}
                  className="mt-4 space-y-3 border-t border-slate-100 pt-4 dark:border-slate-800"
                >
                  <Field label="Who should get this?" htmlFor={`tag-${journey.id}`}>
                    <Select id={`tag-${journey.id}`} name="tagId" defaultValue="">
                      <option value="">Everyone who can receive messages</option>
                      {tags.map((t) => (
                        <option key={t.id} value={t.id}>
                          Tagged {t.name}
                        </option>
                      ))}
                    </Select>
                  </Field>

                  {/*
                    Said plainly. This is the point where a conversation reaches
                    real people and starts costing money, and it cannot be
                    recalled once WhatsApp has it.
                  */}
                  <p className="rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-950 dark:text-amber-200">
                    This sends a real WhatsApp message to everyone in that group
                    and cannot be undone. Anyone who has opted out is skipped
                    automatically, and anyone already partway through this
                    journey is left alone.
                  </p>

                  <label className="flex items-start gap-2 text-sm text-slate-700 dark:text-slate-300">
                    <input type="checkbox" name="confirmed" className="mt-0.5" />
                    I have tested this journey and it is ready to go out.
                  </label>

                  <div className="flex gap-2">
                    <Button type="submit" disabled={isPending}>
                      {isPending ? "Starting…" : "Start it"}
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      onClick={() => setSending(null)}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              )}
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
