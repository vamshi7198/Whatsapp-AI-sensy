"use client";

import { useState, useTransition } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, Input, Select } from "@/components/ui/field";

import {
  changeUserRole,
  inviteUser,
  resetUserPassword,
  setUserActive,
  type UserActionState,
} from "./actions";

interface UserRow {
  id: string;
  name: string;
  email: string;
  role: "ADMIN" | "MANAGER" | "AGENT";
  isActive: boolean;
  lastLoginAt: Date | null;
  createdAt: Date;
}

const ROLE_LABELS: Record<UserRow["role"], string> = {
  ADMIN: "Administrator",
  MANAGER: "Manager",
  AGENT: "Agent",
};

function formatDate(value: Date | null): string {
  if (!value) return "Never";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(new Date(value));
}

/**
 * Shown once after creating or resetting an account.
 *
 * The password is never stored in readable form and cannot be shown again, so
 * the UI says so explicitly rather than letting someone close the panel and
 * assume they can find it later.
 */
function PasswordPanel({
  email,
  password,
  onDismiss,
}: {
  email: string;
  password: string;
  onDismiss: () => void;
}) {
  const [copied, setCopied] = useState(false);

  return (
    <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 dark:border-emerald-900 dark:bg-emerald-950">
      <p className="text-sm font-medium text-emerald-900 dark:text-emerald-200">
        Sign-in details for {email}
      </p>
      <p className="mt-1 text-sm text-emerald-800 dark:text-emerald-300">
        Send these to them securely. This password is shown once and cannot be
        recovered — you can always reset it again.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <code className="flex-1 rounded-lg border border-emerald-300 bg-white px-3 py-2 font-mono text-sm break-all text-slate-900 dark:border-emerald-800 dark:bg-slate-900 dark:text-slate-100">
          {password}
        </code>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={() => {
            void navigator.clipboard.writeText(password);
            setCopied(true);
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Button>
        <Button type="button" variant="ghost" size="sm" onClick={onDismiss}>
          Done
        </Button>
      </div>
    </div>
  );
}

export function UsersManager({
  users,
  currentUserId,
}: {
  users: UserRow[];
  currentUserId: string;
}) {
  const [state, setState] = useState<UserActionState>({});
  const [showInvite, setShowInvite] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [confirmDeactivate, setConfirmDeactivate] = useState<string | null>(
    null,
  );

  function run(
    action: (prev: UserActionState, fd: FormData) => Promise<UserActionState>,
    formData: FormData,
    onSuccess?: () => void,
  ) {
    startTransition(async () => {
      const result = await action({}, formData);
      setState(result);
      if (!result.error) onSuccess?.();
    });
  }

  return (
    <div className="space-y-4">
      {state.error && (
        <div
          role="alert"
          className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950 dark:text-red-300"
        >
          {state.error}
        </div>
      )}

      {state.success && !state.temporaryPassword && (
        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950 dark:text-emerald-300">
          {state.success}
        </div>
      )}

      {state.temporaryPassword && state.createdEmail && (
        <PasswordPanel
          email={state.createdEmail}
          password={state.temporaryPassword}
          onDismiss={() => setState({})}
        />
      )}

      {showInvite ? (
        <form
          action={(fd) =>
            run(inviteUser, fd, () => setShowInvite(false))
          }
          className="space-y-4 rounded-xl border border-slate-200 bg-white p-5 dark:border-slate-800 dark:bg-slate-900"
        >
          <h3 className="text-sm font-semibold text-slate-900 dark:text-slate-50">
            Add a team member
          </h3>

          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Name" htmlFor="name">
              <Input id="name" name="name" required placeholder="Rahul" />
            </Field>
            <Field label="Email" htmlFor="email">
              <Input
                id="email"
                name="email"
                type="email"
                required
                placeholder="rahul@uncanned.in"
              />
            </Field>
            <Field label="Role" htmlFor="role">
              <Select id="role" name="role" defaultValue="MANAGER" required>
                <option value="MANAGER">Manager</option>
                <option value="AGENT">Agent</option>
                <option value="ADMIN">Administrator</option>
              </Select>
            </Field>
          </div>

          <p className="text-xs text-slate-500 dark:text-slate-400">
            A password will be generated and shown to you once. Pass it to them
            securely — they can change it after signing in.
          </p>

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowInvite(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Adding…" : "Add member"}
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex justify-end">
          <Button onClick={() => setShowInvite(true)}>Add team member</Button>
        </div>
      )}

      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-xs text-slate-500 dark:border-slate-800 dark:text-slate-400">
                <th className="px-4 py-2.5 font-medium">Name</th>
                <th className="px-4 py-2.5 font-medium">Role</th>
                <th className="px-4 py-2.5 font-medium">Last signed in</th>
                <th className="px-4 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr
                  key={u.id}
                  className="border-b border-slate-100 last:border-0 dark:border-slate-800"
                >
                  <td className="px-4 py-3">
                    <p className="font-medium text-slate-900 dark:text-slate-100">
                      {u.name}
                      {u.id === currentUserId && (
                        <span className="ml-1.5 text-xs font-normal text-slate-400">
                          (you)
                        </span>
                      )}
                    </p>
                    <p className="text-xs text-slate-400">{u.email}</p>
                  </td>

                  <td className="px-4 py-3">
                    {u.id === currentUserId ? (
                      <Badge tone="neutral">{ROLE_LABELS[u.role]}</Badge>
                    ) : (
                      <form
                        action={(fd) => {
                          fd.set("id", u.id);
                          run(changeUserRole, fd);
                        }}
                      >
                        <Select
                          name="role"
                          defaultValue={u.role}
                          onChange={(e) => e.currentTarget.form?.requestSubmit()}
                          aria-label={`Role for ${u.name}`}
                          className="w-auto text-xs"
                        >
                          <option value="ADMIN">Administrator</option>
                          <option value="MANAGER">Manager</option>
                          <option value="AGENT">Agent</option>
                        </Select>
                      </form>
                    )}
                  </td>

                  <td className="px-4 py-3 whitespace-nowrap text-slate-500 dark:text-slate-400">
                    {formatDate(u.lastLoginAt)}
                  </td>

                  <td className="px-4 py-3">
                    {u.isActive ? (
                      <Badge tone="green">✓ Active</Badge>
                    ) : (
                      <Badge tone="red">✕ Deactivated</Badge>
                    )}
                  </td>

                  <td className="px-4 py-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <form
                        action={(fd) => {
                          fd.set("id", u.id);
                          run(resetUserPassword, fd);
                        }}
                      >
                        <Button
                          type="submit"
                          variant="ghost"
                          size="sm"
                          disabled={isPending}
                        >
                          Reset password
                        </Button>
                      </form>

                      {u.id !== currentUserId &&
                        (confirmDeactivate === u.id ? (
                          <form
                            action={(fd) => {
                              fd.set("id", u.id);
                              fd.set("activate", "false");
                              run(setUserActive, fd, () =>
                                setConfirmDeactivate(null),
                              );
                            }}
                            className="flex items-center gap-1.5"
                          >
                            <span className="text-xs text-red-700 dark:text-red-400">
                              Sign them out now?
                            </span>
                            <Button
                              type="submit"
                              variant="danger"
                              size="sm"
                              disabled={isPending}
                            >
                              Yes
                            </Button>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => setConfirmDeactivate(null)}
                            >
                              No
                            </Button>
                          </form>
                        ) : u.isActive ? (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="text-red-600 dark:text-red-400"
                            onClick={() => setConfirmDeactivate(u.id)}
                          >
                            Deactivate
                          </Button>
                        ) : (
                          <form
                            action={(fd) => {
                              fd.set("id", u.id);
                              fd.set("activate", "true");
                              run(setUserActive, fd);
                            }}
                          >
                            <Button
                              type="submit"
                              variant="ghost"
                              size="sm"
                              disabled={isPending}
                            >
                              Reactivate
                            </Button>
                          </form>
                        ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
