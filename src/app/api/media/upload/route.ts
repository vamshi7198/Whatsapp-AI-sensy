import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { NextResponse } from "next/server";

import { audit } from "@/lib/audit";
import { getCurrentUser } from "@/lib/auth/session";
import { env } from "@/lib/env";
import { moduleLogger } from "@/lib/logger";
import { can } from "@/lib/rbac";

const log = moduleLogger("media-upload");

/**
 * Stores a campaign image and returns a public URL.
 *
 * Deliberately not Meta's media API. An uploaded media id expires after about
 * a week, so a campaign repeated a month later would fail with a confusing
 * error. Serving the file ourselves means the link keeps working, and Meta
 * fetches it at send time.
 */

const MAX_BYTES = 5 * 1024 * 1024;

const ALLOWED: Record<string, { ext: string; kind: string }> = {
  "image/jpeg": { ext: "jpg", kind: "image" },
  "image/png": { ext: "png", kind: "image" },
  "video/mp4": { ext: "mp4", kind: "video" },
  "application/pdf": { ext: "pdf", kind: "document" },
};

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!can(user, "campaign:create")) {
    return new NextResponse("Not found", { status: 404 });
  }

  const formData = await request.formData();
  const file = formData.get("file");

  if (!(file instanceof File) || file.size === 0) {
    return NextResponse.json({ error: "Choose a file." }, { status: 400 });
  }

  const allowed = ALLOWED[file.type];
  if (!allowed) {
    return NextResponse.json(
      {
        error:
          "WhatsApp accepts JPG and PNG images, MP4 video, or PDF documents.",
      },
      { status: 400 },
    );
  }

  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      { error: "That file is larger than 5 MB." },
      { status: 400 },
    );
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  // Content-hashed name: re-uploading the same image reuses the same URL
  // rather than filling the disk with duplicates.
  const hash = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const filename = `${hash}-${randomUUID().slice(0, 8)}.${allowed.ext}`;

  const dir = join(process.cwd(), "public", "media");
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, filename), bytes);

  const url = `${env.APP_URL}/media/${filename}`;

  log.info({ filename, bytes: file.size, type: file.type }, "Media stored");

  await audit(user, "media.upload", {
    metadata: { filename, bytes: file.size, type: file.type },
  });

  return NextResponse.json({
    url,
    kind: allowed.kind,
    bytes: file.size,
  });
}
