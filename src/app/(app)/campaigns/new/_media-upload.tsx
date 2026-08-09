"use client";

import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";

/**
 * Uploads the image, video or document that sits at the top of a
 * media-header template.
 *
 * The file is stored by this app and sent to Meta as a link rather than an
 * uploaded media id — Meta expires uploaded media after about a week, so a
 * campaign repeated a month later would otherwise fail.
 */
export function MediaUpload({
  mediaType,
  value,
  onChange,
}: {
  mediaType: "image" | "video" | "document";
  value: string | null;
  onChange: (url: string | null) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const accept =
    mediaType === "image"
      ? "image/jpeg,image/png"
      : mediaType === "video"
        ? "video/mp4"
        : "application/pdf";

  const label =
    mediaType === "image"
      ? "image"
      : mediaType === "video"
        ? "video"
        : "PDF document";

  async function upload(file: File) {
    setError(null);
    setUploading(true);

    try {
      const formData = new FormData();
      formData.set("file", file);

      const response = await fetch("/api/media/upload", {
        method: "POST",
        body: formData,
      });

      const body = (await response.json()) as { url?: string; error?: string };

      if (!response.ok || !body.url) {
        setError(body.error ?? "Could not upload that file.");
        return;
      }

      onChange(body.url);
    } catch {
      setError("Could not upload that file. Please try again.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50 p-3 dark:border-amber-900 dark:bg-amber-950">
      <p className="text-sm font-medium text-amber-900 dark:text-amber-200">
        This template needs {mediaType === "image" ? "an" : "a"} {label} at the
        top
      </p>
      <p className="text-xs text-amber-800 dark:text-amber-300">
        Every recipient sees the same one. Without it WhatsApp refuses the whole
        campaign.
      </p>

      {value ? (
        <div className="space-y-2">
          {mediaType === "image" ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={value}
              alt="Campaign header"
              className="max-h-40 rounded-lg border border-amber-300 dark:border-amber-800"
            />
          ) : (
            <p className="truncate rounded-lg bg-white px-3 py-2 text-xs dark:bg-slate-900">
              {value.split("/").pop()}
            </p>
          )}

          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              onChange(null);
              if (inputRef.current) inputRef.current.value = "";
            }}
          >
            Choose a different {label}
          </Button>
        </div>
      ) : (
        <input
          ref={inputRef}
          type="file"
          accept={accept}
          disabled={uploading}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
          }}
          className="w-full text-xs file:mr-3 file:rounded file:border-0 file:bg-white file:px-3 file:py-1.5 file:text-sm dark:file:bg-slate-800"
        />
      )}

      {uploading && (
        <p className="text-xs text-amber-800 dark:text-amber-300">Uploading…</p>
      )}
      {error && (
        <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
      )}
    </div>
  );
}
