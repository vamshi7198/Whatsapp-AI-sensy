"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useState, useTransition } from "react";

import { Button } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/field";
import type { ContactFilter } from "@/lib/contacts/schema";

interface TagOption {
  id: string;
  name: string;
  contactCount: number;
}

export function ContactFilters({
  tags,
  sources,
  filter,
}: {
  tags: TagOption[];
  sources: string[];
  filter: ContactFilter;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [search, setSearch] = useState(filter.search ?? "");

  function apply(updates: Record<string, string | undefined>) {
    const params = new URLSearchParams(searchParams.toString());

    for (const [key, value] of Object.entries(updates)) {
      if (value) params.set(key, value);
      else params.delete(key);
    }
    // Any filter change resets to page 1; staying on page 7 of a now-shorter
    // result set shows an empty table and reads as "no results".
    params.delete("page");

    startTransition(() => router.push(`/contacts?${params.toString()}`));
  }

  const hasFilters = Boolean(
    filter.search || filter.tagIds?.length || filter.optInStatus || filter.source,
  );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          apply({ search: search.trim() || undefined });
        }}
        className="flex min-w-55 flex-1 gap-2"
      >
        <Input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search name, phone or email"
          aria-label="Search contacts"
        />
        <Button type="submit" variant="secondary" disabled={isPending}>
          Search
        </Button>
      </form>

      <Select
        aria-label="Filter by tag"
        value={filter.tagIds?.[0] ?? ""}
        onChange={(e) => apply({ tag: e.target.value || undefined })}
        className="w-auto"
      >
        <option value="">All tags</option>
        {tags.map((t) => (
          <option key={t.id} value={t.id}>
            {t.name} ({t.contactCount})
          </option>
        ))}
      </Select>

      <Select
        aria-label="Filter by opt-in status"
        value={filter.optInStatus ?? ""}
        onChange={(e) => apply({ optIn: e.target.value || undefined })}
        className="w-auto"
      >
        <option value="">Any opt-in status</option>
        <option value="OPTED_IN">Opted in</option>
        <option value="UNKNOWN">Not confirmed</option>
        <option value="OPTED_OUT">Opted out</option>
      </Select>

      {sources.length > 0 && (
        <Select
          aria-label="Filter by source"
          value={filter.source ?? ""}
          onChange={(e) => apply({ source: e.target.value || undefined })}
          className="w-auto"
        >
          <option value="">Any source</option>
          {sources.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
      )}

      <Select
        aria-label="Sort by"
        value={`${filter.sortBy}:${filter.sortDir}`}
        onChange={(e) => {
          const [sortBy, sortDir] = e.target.value.split(":");
          apply({ sortBy, sortDir });
        }}
        className="w-auto"
      >
        <option value="createdAt:desc">Newest first</option>
        <option value="createdAt:asc">Oldest first</option>
        <option value="name:asc">Name A–Z</option>
        <option value="name:desc">Name Z–A</option>
        <option value="lastContactedAt:desc">Recently contacted</option>
      </Select>

      {hasFilters && (
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setSearch("");
            startTransition(() => router.push("/contacts"));
          }}
        >
          Clear
        </Button>
      )}
    </div>
  );
}
