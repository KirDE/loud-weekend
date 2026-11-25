import { db } from "@/lib/db";
import { correctionReportInput } from "@/lib/correction-report-input";
import { correctionReporterHash, submitCorrection } from "@/lib/correction-reports";
import { rejectUntrustedOrigin } from "@/lib/request-origin";

const reply = (status: number) =>
  Response.json({ accepted: status === 202 }, { status, headers: { "Cache-Control": "no-store" } });

export async function POST(request: Request) {
  const originError = rejectUntrustedOrigin(request);
  if (originError) return originError;
  if (request.headers.get("content-type")?.split(";")[0] !== "application/json" || !request.body)
    return reply(400);
  const secret = process.env.SUBMISSION_HASH_SALT || process.env.AUTH_SECRET;
  if (!secret) return reply(503);

  const reader = request.body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let bytes = 0;
  let text = "";
  let data: unknown;
  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 4096) {
        void reader.cancel().catch(() => {});
        return reply(413);
      }
      text += decoder.decode(chunk.value, { stream: true });
    }
    data = JSON.parse(text + decoder.decode());
  } catch {
    void reader.cancel().catch(() => {});
    return reply(400);
  } finally {
    reader.releaseLock();
  }

  const input = correctionReportInput.safeParse(data);
  if (!input.success) return reply(422);
  try {
    const result = await submitCorrection(
      db,
      input.data,
      correctionReporterHash(request.headers, secret),
    );
    switch (result) {
      case "missing":
        return reply(404);
      case "source":
        return reply(422);
      case "limited":
        return reply(429);
      default:
        return reply(202);
    }
  } catch {
    return reply(503);
  }
}
