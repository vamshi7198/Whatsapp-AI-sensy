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

/**
 * Does the file's own content match what it claims to be?
 *
 * Only the first few bytes, which is all that is needed to tell a real JPEG
 * from a text file someone renamed. Not a security control — the extension is
 * chosen from our own allowlist, so nothing here can be served as executable —
 * but a practical one: Meta rejects a mislabelled file at send time, and a
 * campaign discovers that once per recipient.
 */
function looksLike(bytes: Buffer, declaredType: string): boolean {
  const starts = (...sig: number[]) =>
    sig.every((byte, i) => bytes[i] === byte);

  switch (declaredType) {
    case "image/jpeg":
      return starts(0xff, 0xd8, 0xff);
    case "image/png":
      return starts(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
    case "application/pdf":
      return starts(0x25, 0x50, 0x44, 0x46); // %PDF
    case "video/mp4":
      // The size box comes first, so the marker sits at offset 4.
      return bytes.subarray(4, 8).toString("ascii") === "ftyp";
    default:
      return false;
  }
}

export async function POST(request: Request) {
  const user = await getCurrentUser();

  if (!can(user, "campaign:create")) {
    return new NextResponse("Not found", { status: 404 });
  }

  // Checked BEFORE parsing. request.formData() buffers the whole body into
  // memory, so testing file.size afterwards means a 500 MB upload is already
  // resident before it is rejected — on a laptop that is also running
  // PostgreSQL. Next.js applies its body limit to server actions, not to route
  // handlers, so nothing else stops it.
  //
  // Content-Length can be absent or lied about, hence the second check on the
  // real size further down. This one exists to refuse the obvious cases cheaply.
  const declared = Number(request.headers.get("content-length") ?? 0);

  if (declared > MAX_BYTES * 1.1) {
    return NextResponse.json(
      { error: "That file is larger than 5 MB." },
      { status: 413 },
    );
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

  // The browser's declared type is just a label, and a mislabelled file is
  // accepted here and then rejected by Meta at SEND time — once per recipient,
  // after the campaign has started. Far better to catch it now, while someone
  // is looking at the screen.
  if (!looksLike(bytes, file.type)) {
    return NextResponse.json(
      {
        error:
          "That file is not really a " +
          allowed.ext.toUpperCase() +
          ". Re-save it in the right format and try again.",
      },
      { status: 400 },
    );
  }

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
