"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Field, Input, Textarea } from "@/components/ui/field";

import { deleteContact, updateContact } from "../actions";
import type { ActionState } from "../actions";

interface TagOption {
  id: string;
  name: string;
}

interface ContactValues {
  id: string;
  name: string | null;
  phoneE164: string;
  email: string | null;
  notes: string | null;
  optedIn: boolean;
  tagIds: string[];
}

export function EditContactButton({
  contact,
  tags,
  canDelete,
}: {
  contact: ContactValues;
  tags: TagOption[];
  canDelete: boolean;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<ActionState>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [isPending, startTransition] = useTransition();
  const dialogRef = useRef<HTMLDialogElement>(null);

  // Drives the <dialog> element only — an external DOM API, never setState,
  // so it cannot cascade renders.
  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  function handleSave(formData: FormData) {
    formData.set("id", contact.id);
    startTransition(async () => {
      const result = await updateContact({}, formData);
      if (result.error) {
        setState(result);
      } else {
        setState({});
        setOpen(false);
        router.refresh();
      }
    });
  }

  function handleDelete() {
    startTransition(async () => {
      const formData = new FormData();
      formData.set("id", contact.id);
      const result = await deleteContact({}, formData);
      if (result.error) setState(result);
      else router.push("/contacts");
    });
  }

  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        Edit
      </Button>

      <dialog
        ref={dialogRef}
        onClose={() => setOpen(false)}
        className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-0 backdrop:bg-slate-900/40 dark:border-slate-800 dark:bg-slate-900"
      >
        <form action={handleSave} className="space-y-4 p-5">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-50">
            Edit contact
          </h2>

          {state.error && (
            <div
              role="alert"
              className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
            >
              {state.error}
            </div>
          )}

          <Field label="Name" htmlFor="edit-name">
            <Input
              id="edit-name"
              name="name"
              defaultValue={contact.name ?? ""}
              placeholder="Vamshi"
            />
          </Field>

          <Field
            label="Phone number"
            htmlFor="edit-phone"
            hint="with country code"
          >
            <Input
              id="edit-phone"
              name="phone"
              defaultValue={contact.phoneE164}
              required
              inputMode="tel"
            />
            <p className="mt-1 text-xs text-slate-400">
              Changing this moves the whole message history to the new number.
            </p>
          </Field>

          <Field label="Email" htmlFor="edit-email">
            <Input
              id="edit-email"
              name="email"
              type="email"
              defaultValue={contact.email ?? ""}
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
                      defaultChecked={contact.tagIds.includes(t.id)}
                      className="rounded border-slate-300"
                    />
                    {t.name}
                  </label>
                ))}
              </div>
            </fieldset>
          )}

          <Field label="Notes" htmlFor="edit-notes">
            <Textarea
              id="edit-notes"
              name="notes"
              rows={2}
              defaultValue={contact.notes ?? ""}
            />
          </Field>

          <label className="flex items-start gap-2 rounded-lg border border-slate-200 p-3 dark:border-slate-700">
            <input
              type="checkbox"
              name="optedIn"
              defaultChecked={contact.optedIn}
              className="mt-0.5 rounded border-slate-300"
            />
            <span className="text-sm text-slate-700 dark:text-slate-300">
              Has agreed to receive marketing messages
              <span className="mt-0.5 block text-xs text-slate-500 dark:text-slate-400">
                Unticking this stops marketing campaigns reaching them. Order
                and account updates are unaffected.
              </span>
            </span>
          </label>

          <div className="flex items-center justify-between gap-2 pt-1">
            {canDelete &&
              (confirmDelete ? (
                <div className="flex items-center gap-1.5">
                  <span className="text-xs text-red-700 dark:text-red-400">
                    Delete?
                  </span>
                  <Button
                    type="button"
                    variant="danger"
                    size="sm"
                    disabled={isPending}
                    onClick={handleDelete}
                  >
                    Yes
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setConfirmDelete(false)}
                  >
                    No
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="text-red-600 dark:text-red-400"
                  onClick={() => setConfirmDelete(true)}
                >
                  Delete contact
                </Button>
              ))}

            <div className="ml-auto flex gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isPending}>
                {isPending ? "Saving…" : "Save changes"}
              </Button>
            </div>
          </div>
        </form>
      </dialog>
    </>
  );
}
