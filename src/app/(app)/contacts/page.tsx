import Link from "next/link";

import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { requireAuth } from "@/lib/auth/guards";
import { contactFilterSchema } from "@/lib/contacts/schema";
import {
  getContactCounts,
  listContactSources,
  listContacts,
  listTags,
} from "@/lib/contacts/service";
import { can } from "@/lib/rbac";
import { getDefaultOptIn } from "@/lib/settings";
import { formatNumber } from "@/lib/utils";

import { ContactFilters } from "./_components/contact-filters";
import { ContactsTable } from "./_components/contacts-table";
import { NewContactButton } from "./_components/new-contact-dialog";

export const metadata = { title: "Contacts" };

export default async function ContactsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireAuth("contact:view");
  const params = await searchParams;

  const filter = contactFilterSchema.parse({
    search: params.search,
    tagIds: params.tag
      ? Array.isArray(params.tag)
        ? params.tag
        : [params.tag]
      : undefined,
    optInStatus: params.optIn,
    source: params.source,
    sortBy: params.sortBy,
    sortDir: params.sortDir,
    page: params.page,
  });

  // Every filter the page is showing, so the export matches what is on screen.
  // Tags were previously left out entirely, which meant narrowing to one tag
  // and exporting quietly produced the whole database.
  const exportParams = new URLSearchParams();
  if (filter.search) exportParams.set("search", filter.search);
  if (filter.optInStatus) exportParams.set("optIn", filter.optInStatus);
  if (filter.source) exportParams.set("source", filter.source);
  for (const tagId of filter.tagIds ?? []) exportParams.append("tag", tagId);

  const [result, tags, sources, counts, defaultOptIn] = await Promise.all([
    listContacts(filter),
    listTags(),
    listContactSources(),
    getContactCounts(),
    getDefaultOptIn(),
  ]);

  const isFiltered = Boolean(
    filter.search || filter.tagIds?.length || filter.optInStatus || filter.source,
  );

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900 dark:text-slate-50">
            Contacts
          </h1>
          <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">
            {formatNumber(counts.total)} total ·{" "}
            {formatNumber(counts.marketingEligible)} can receive marketing
          </p>
        </div>

        <div className="flex items-center gap-2">
          {can(user, "contact:export") && result.total > 0 && (
            <a
              href={`/api/contacts/export?${exportParams.toString()}`}
              className={buttonVariants({ variant: "secondary" })}
            >
              Export CSV
              {/*
                Says what will actually come out. The tag filter used not to
                reach the export at all, so narrowing to one tag and clicking
                this returned the whole database — with nothing to reveal it
                until someone counted the rows.
              */}
              {result.total !== counts.total && (
                <span className="ml-1 opacity-70">
                  ({formatNumber(result.total)})
                </span>
              )}
            </a>
          )}
          {can(user, "tag:view") && (
            <Link href="/contacts/tags">
              <Button variant="secondary">Tags</Button>
            </Link>
          )}
          {can(user, "contact:import") && (
            <Link href="/contacts/import">
              <Button variant="secondary">Import CSV</Button>
            </Link>
          )}
          {can(user, "contact:create") && (
            <NewContactButton tags={tags} defaultOptIn={defaultOptIn} />
          )}
        </div>
      </div>

      {counts.total > 0 && counts.marketingEligible === 0 && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 dark:border-amber-900 dark:bg-amber-950">
          <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
            No contacts can receive marketing messages yet
          </p>
          <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">
            Marketing campaigns only go to contacts who have opted in. Utility
            messages, such as order updates, are not affected.
          </p>
        </div>
      )}

      <ContactFilters tags={tags} sources={sources} filter={filter} />

      <div className="rounded-xl border border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        {result.items.length === 0 ? (
          isFiltered ? (
            <EmptyState
              title="No contacts match these filters"
              description="Try a different search term, or clear the filters to see everyone."
              action={
                <Link href="/contacts">
                  <Button variant="secondary">Clear filters</Button>
                </Link>
              }
            />
          ) : (
            <EmptyState
              title="No contacts yet"
              description="Import your existing contacts from a CSV file, or add someone manually to get started."
              action={
                can(user, "contact:import") ? (
                  <Link href="/contacts/import">
                    <Button>Import CSV</Button>
                  </Link>
                ) : undefined
              }
            />
          )
        ) : (
          <ContactsTable
            contacts={result.items}
            tags={tags}
            canDelete={can(user, "contact:delete")}
            canEdit={can(user, "contact:edit")}
          />
        )}
      </div>

      {result.totalPages > 1 && (
        <div className="flex items-center justify-between text-sm">
          <p className="text-slate-500 dark:text-slate-400">
            Page {result.page} of {result.totalPages} ·{" "}
            {formatNumber(result.total)} contacts
          </p>
          <div className="flex gap-2">
            {result.page > 1 && (
              <Link
                href={`/contacts?${new URLSearchParams({ ...(params as Record<string, string>), page: String(result.page - 1) })}`}
              >
                <Button variant="secondary" size="sm">
                  Previous
                </Button>
              </Link>
            )}
            {result.page < result.totalPages && (
              <Link
                href={`/contacts?${new URLSearchParams({ ...(params as Record<string, string>), page: String(result.page + 1) })}`}
              >
                <Button variant="secondary" size="sm">
                  Next
                </Button>
              </Link>
            )}
          </div>
        </div>
      )}

      {tags.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 pt-2">
          <span className="text-xs text-slate-400">Tags:</span>
          {tags.map((t) => (
            <Link key={t.id} href={`/contacts?tag=${t.id}`}>
              <Badge tone="blue">
                {t.name} · {t.contactCount}
              </Badge>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
