"use client";

import Link from "next/link";
import { useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";

import { createContact, type ActionState } from "../actions";

interface TagOption {
  id: string;
  name: string;
}

export function NewContactButton({
  tags,
  defaultOptIn = false,
}: {
  tags: TagOption[];
  /** Set in Settings → Consent. Pre-ticks the box; never forces it. */
  defaultOptIn?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ActionState>({});
  const [isPending, startTransition] = useTransition();
  const dialogRef = useRef<HTMLDialogElement>(null);

  // The effect only drives the <dialog> element — an external DOM API — and
  // never calls setState, so it cannot cascade renders.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function handleSubmit(formData: FormData) {
    startTransition(async () => {
      const result = await createContact({}, formData);

      // Close only on success. On error the dialog stays open with the user's
      // typed values intact, so a duplicate number can be corrected rather
      // than retyped from scratch.
      if (result.error) {
        setState(result);
      } else {
        setState({});
        setOpen(false);
      }
    });
  }

  return (
    <>
      <Button
        onClick={() => {
          setState({});
          setOpen(true);
        }}
      >
        Add contact
      </Button>

      <dialog
        ref={dialogRef}
        onClose={() => setOpen(false)}
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-0 backdrop:bg-slate-900/40 dark:border-slate-800 dark:bg-slate-900"
      >
        <form action={handleSubmit} className="space-y-4 p-5">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
              Add contact
            </h2>
            <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">
              Phone number is required and must be unique.
            </p>
          </div>

          {state.error && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
            >
              {state.error}
              {state.duplicateContactId && (
                <Link
                  href={`/contacts/${state.duplicateContactId}`}
                  className="ml-1 font-medium underline"
                >
                  Open it
                </Link>
              )}
            </div>
          )}

          <Field label="Name" htmlFor="name" hint="optional">
            <Input id="name" name="name" placeholder="Vamshi" />
          </Field>

          <Field label="Phone number" htmlFor="phone" hint="with country code">
            <Input
              id="phone"
              name="phone"
              required
              placeholder="+91 98765 43210"
              inputMode="tel"
            />
          </Field>

          <Field label="Email" htmlFor="email" hint="optional">
            <Input
              id="email"
              name="email"
              type="email"
              placeholder="vamshi@email.com"
            />
          </Field>

          {tags.length > 0 && (
            <fieldset className="space-y-1.5">
              <legend className="text-sm font-medium text-slate-700 dark:text-slate-300">
                Tags
              </legend>
              <div className="flex flex-wrap gap-2 pt-1">
                {tags.map((t) => (
                  <label
                    key={t.id}
                    className="flex items-center gap-1.5 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 dark:border-slate-700 dark:text-slate-300"
                  >
                    <input
                      type="checkbox"
                      name="tagIds"
                      value={t.id}
                      className="rounded border-slate-300"
                    />
                    {t.name}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <Field label="Notes" htmlFor="notes" hint="optional">
            <Textarea id="notes" name="notes" rows={2} />
          </Field>

          {/* Consent is explicit and off by default. It is never inferred from
              the fact that we hold someone's number. */}
          <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <input
              type="checkbox"
              name="optedIn"
              defaultChecked={defaultOptIn}
              className="mt-0.5 rounded border-slate-300"
            />
            <span className="text-sm text-slate-700 dark:text-slate-300">
              This contact has agreed to receive marketing messages
              <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                Leave unticked if you are not sure. They can still receive
                order and account updates.
              </span>
            </span>
          </label>

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving…" : "Add contact"}
            </Button>
          </div>
        </form>
      </dialog>
    </>
  );
}
