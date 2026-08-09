"use client";

import Link from "next/link";
import { useActionState, useState } from "react";

import { Badge, OptInBadge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/field";
import type { ContactListItem } from "@/lib/contacts/service";
import { formatPhoneForDisplay } from "@/lib/contacts/phone";

import { bulkContactAction, type ActionState } from "../actions";

interface TagOption {
  id: string;
  name: string;
}

function formatDate(value: Date | null): string {
  if (!value) return "—";
  return new Intl.DateTimeFormat("en-IN", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    timeZone: "Asia/Kolkata",
  }).format(value);
}

export function ContactsTable({
  contacts,
  tags,
  canDelete,
  canEdit,
}: {
  contacts: ContactListItem[];
  tags: TagOption[];
  canDelete: boolean;
  canEdit: boolean;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkTagId, setBulkTagId] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [state, formAction, isPending] = useActionState<ActionState, FormData>(
    bulkContactAction,
    {},
  );

  const allSelected = contacts.length > 0 && selected.size === contacts.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(contacts.map((c) => c.id)));
  }

  const showBulkBar = selected.size > 0 && (canEdit || canDelete);

  return (
    <div>
      {state.error && (
        <div className="border-b border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300">
          {state.error}
        </div>
      )}
      {state.success && (
        <div className="border-b border-emerald-200 bg-emerald-50 px-4 py-2.5 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
          {state.success}
        </div>
      )}

      {showBulkBar && (
        <form
          action={formAction}
          className="flex flex-wrap items-center gap-2 border-b border-slate-200 bg-slate-50 px-4 py-2.5 dark:border-slate-800 dark:bg-slate-800/50"
        >
          {[...selected].map((id) => (
            <input key={id} type="hidden" name="contactIds" value={id} />
          ))}

          <span className="text-sm font-medium text-slate-700 dark:text-slate-300">
            {selected.size} selected
          </span>

          {canEdit && tags.length > 0 && (
            <>
              <Select
                name="tagId"
                value={bulkTagId}
                onChange={(e) => setBulkTagId(e.target.value)}
                aria-label="Choose tag"
                className="w-auto"
              >
                <option value="">Choose tag…</option>
                {tags.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </Select>

              <Button
                type="submit"
                name="action"
                value="addTag"
                variant="secondary"
                size="sm"
                disabled={!bulkTagId || isPending}
              >
                Add tag
              </Button>
              <Button
                type="submit"
                name="action"
                value="removeTag"
                variant="secondary"
                size="sm"
                disabled={!bulkTagId || isPending}
              >
                Remove tag
              </Button>
            </>
          )}

          {canDelete &&
            (confirmDelete ? (
              <div className="flex items-center gap-2">
                <span className="text-sm text-red-700 dark:text-red-400">
                  Delete {selected.size}? Message history is kept.
                </span>
                <Button
                  type="submit"
                  name="action"
                  value="delete"
                  variant="danger"
                  size="sm"
                  disabled={isPending}
                >
                  Yes, delete
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setConfirmDelete(false)}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="text-red-600 hover:bg-red-50 dark:text-red-400"
                onClick={() => setConfirmDelete(true)}
              >
                Delete
              </Button>
            ))}

          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setSelected(new Set())}
            className="ml-auto"
          >
            Clear selection
          </Button>
        </form>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
              <th className="w-10 px-4 py-2.5">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={toggleAll}
                  aria-label="Select all contacts on this page"
                  className="rounded border-slate-300"
                />
              </th>
              <th className="px-4 py-2.5 font-medium">Name</th>
              <th className="px-4 py-2.5 font-medium">Phone</th>
              <th className="px-4 py-2.5 font-medium">Tags</th>
              <th className="px-4 py-2.5 font-medium">Opt-in</th>
              <th className="px-4 py-2.5 font-medium">Last contacted</th>
              <th className="px-4 py-2.5 font-medium">Added</th>
            </tr>
          </thead>
          <tbody>
            {contacts.map((c) => (
              <tr
                key={c.id}
                className="border-b border-slate-100 last:border-0 hover:bg-slate-50 dark:border-slate-800 dark:hover:bg-slate-800/40"
              >
                <td className="px-4 py-3">
                  <input
                    type="checkbox"
                    checked={selected.has(c.id)}
                    onChange={() => toggle(c.id)}
                    aria-label={`Select ${c.name ?? c.phoneE164}`}
                    className="rounded border-slate-300"
                  />
                </td>
                <td className="px-4 py-3">
                  <Link
                    href={`/contacts/${c.id}`}
                    className="font-medium text-slate-900 hover:text-emerald-700 dark:text-slate-100 dark:hover:text-emerald-400"
                  >
                    {c.name || "Unnamed"}
                  </Link>
                  {c.email && (
                    <p className="text-xs text-slate-400">{c.email}</p>
                  )}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-slate-600 tabular-nums dark:text-slate-400">
                  {formatPhoneForDisplay(c.phoneE164)}
                </td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-1">
                    {c.tags.slice(0, 3).map(({ tag }) => (
                      <Badge key={tag.id} tone="blue">
                        {tag.name}
                      </Badge>
                    ))}
                    {c.tags.length > 3 && (
                      <Badge tone="neutral">+{c.tags.length - 3}</Badge>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3">
                  <OptInBadge
                    status={c.optInStatus}
                    marketingOptOut={c.marketingOptOut}
                  />
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-slate-500 dark:text-slate-400">
                  {formatDate(c.lastContactedAt)}
                </td>
                <td className="px-4 py-3 whitespace-nowrap text-slate-500 dark:text-slate-400">
                  {formatDate(c.createdAt)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
