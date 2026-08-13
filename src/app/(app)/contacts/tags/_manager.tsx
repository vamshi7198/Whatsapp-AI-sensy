"use client";

import Link from "next/link";
import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/field";
import { formatNumber } from "@/lib/utils";

import { createTag, deleteTag, type ActionState } from "../actions";

interface TagRow {
  id: string;
  name: string;
  color: string | null;
  contacts: number;
  /** Journey steps and automations that add or remove this tag. */
  usedInAutomation: number;
}

export function TagManager({
  canManage,
  tags,
}: {
  canManage: boolean;
  tags: TagRow[];
}) {
  const [state, setState] = useState<ActionState>({});
  const [isPending, startTransition] = useTransition();
  const [confirming, setConfirming] = useState<string | null>(null);

  return (
    <div className="space-y-5">
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

      {canManage && (
        <section className="rounded-xl border border-slate-200 bg-white p-4 dark:border-slate-800 dark:bg-slate-900">
          <form
            action={(formData) => {
              startTransition(async () => {
                setState(await createTag({}, formData));
              });
            }}
            className="flex flex-wrap items-end gap-3"
          >
            <div className="min-w-48 flex-1">
              <Field
                label="New tag"
                htmlFor="name"
                hint="Lower case, no spaces needed — 'wholesale' or 'sample-claimed'."
              >
                <Input
                  id="name"
                  name="name"
                  required
                  maxLength={40}
                  placeholder="sample-claimed"
                />
              </Field>
            </div>

            <Button type="submit" disabled={isPending}>
              {isPending ? "Adding…" : "Add tag"}
            </Button>
          </form>
        </section>
      )}

      {tags.length === 0 ? (
        <div className="rounded-xl border border-slate-200 bg-white p-10 text-center dark:border-slate-800 dark:bg-slate-900">
          <p className="text-sm text-slate-500 dark:text-slate-400">
            No tags yet.
          </p>
        </div>
      ) : (
        <section className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <th className="px-4 py-2.5 font-medium">Tag</th>
                <th className="px-4 py-2.5 font-medium">People</th>
                <th className="px-4 py-2.5 font-medium">Used by</th>
                <th className="px-4 py-2.5"></th>
              </tr>
            </thead>
            <tbody>
              {tags.map((tag) => (
                <tr
                  key={tag.id}
                  className="border-b border-slate-100 last:border-0 dark:border-slate-800"
                >
                  <td className="px-4 py-2.5">
                    <Badge tone="neutral">{tag.name}</Badge>
                  </td>

                  <td className="px-4 py-2.5">
                    {tag.contacts > 0 ? (
                      <Link
                        href={`/contacts?tag=${tag.id}`}
                        className="text-slate-700 hover:underline dark:text-slate-300"
                      >
                        {formatNumber(tag.contacts)}
                      </Link>
                    ) : (
                      <span className="text-slate-400">none</span>
                    )}
                  </td>

                  <td className="px-4 py-2.5 text-xs text-slate-500 dark:text-slate-400">
                    {tag.usedInAutomation > 0
                      ? `${tag.usedInAutomation} journey or automation step`
                      : "—"}
                  </td>

                  <td className="px-4 py-2.5 text-right">
                    {canManage &&
                      (confirming === tag.id ? (
                        <div className="flex items-center justify-end gap-2">
                          {/*
                            Said before the button, not after. Deleting a tag
                            an automation depends on breaks it silently — the
                            step simply stops doing anything.
                          */}
                          <span className="text-xs text-slate-600 dark:text-slate-400">
                            {tag.usedInAutomation > 0
                              ? `${tag.usedInAutomation} step(s) use this and will stop working.`
                              : tag.contacts > 0
                                ? `Removes it from ${formatNumber(tag.contacts)} contact(s). They are not deleted.`
                                : "Delete it?"}
                          </span>
                          <Button
                            variant="danger"
                            size="sm"
                            disabled={isPending}
                            onClick={() => {
                              const formData = new FormData();
                              formData.set("id", tag.id);
                              startTransition(async () => {
                                setState(await deleteTag({}, formData));
                                setConfirming(null);
                              });
                            }}
                          >
                            Delete
                          </Button>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setConfirming(null)}
                          >
                            Keep
                          </Button>
                        </div>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirming(tag.id)}
                        >
                          Delete
                        </Button>
                      ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <p className="text-xs text-slate-400">
        Deleting a tag removes it from every contact. The contacts themselves
        are never deleted.
      </p>
    </div>
  );
}
