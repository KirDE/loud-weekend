import { z } from "zod";
import { currentAdmin } from "@/lib/admin-access";
import { db } from "@/lib/db";
import { rejectUntrustedOrigin } from "@/lib/request-origin";
import { decideHellfestOffers } from "@/lib/ingestion/ticket-offer-proposal-store";

const bodySchema = z
  .object({
    decision: z.enum(["approve", "reject"]),
    expectedContentHash: z.string().regex(/^[a-f0-9]{64}$/),
  })
  .strict();
const reply = (body: unknown, status = 200) =>
  Response.json(body, { status, headers: { "cache-control": "private, no-store" } });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const originError = rejectUntrustedOrigin(request);
  if (originError) return originError;
  const admin = await currentAdmin();
  if (!admin) return reply({ error: "Forbidden" }, 403);
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !==
      "application/json" ||
    !request.body
  ) {
    return reply({ error: "JSON decision required" }, 400);
  }
  // Bound the actual stream, not the caller's Content-Length. Authentication
  // and origin validation happen before any body read or database access.
  const reader = request.body.getReader();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error("Body deadline")), 5_000);
  });
  let body: z.infer<typeof bodySchema>;
  try {
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await Promise.race([reader.read(), deadline]);
      if (done) break;
      size += value.byteLength;
      if (size > 4096) return reply({ error: "Decision too large" }, 413);
      chunks.push(value);
    }
    body = bodySchema.parse(
      JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks))),
    );
  } catch {
    return reply({ error: "Invalid decision request" }, 400);
  } finally {
    clearTimeout(timer);
    void reader.cancel().catch(() => {});
  }
  try {
    const result = await decideHellfestOffers(db, {
      ...body,
      snapshotId: (await params).id,
      actorId: admin.id,
    });
    // Do not expose persisted actor IDs, audit records or database diagnostics.
    return reply({ snapshotId: result.snapshotId, decision: result.decision });
  } catch {
    return reply({ error: "Tier decision conflict or unavailable proposal" }, 409);
  }
}
