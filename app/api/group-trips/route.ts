import { z } from "zod";
import { requireUser } from "@/lib/api";
import { db } from "@/lib/db";
import {
  acceptGroupTripInvite,
  addGroupTripComment,
  createGroupTrip,
  deleteGroupTrip,
  GroupTripError,
  inviteToGroupTrip,
  leaveGroupTrip,
  listGroupTrips,
  readGroupTrip,
  removeGroupTripComment,
  revokeGroupTripInvite,
  setGroupTripVote,
} from "@/lib/group-trips";
import { requestHasTrustedOrigin } from "@/lib/request-origin";

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/);
const action = z.discriminatedUnion("kind", [
  z.strictObject({
    kind: z.literal("create"),
    title: z.string().trim().min(1).max(80),
    editionIds: z.array(id).min(1).max(12),
  }),
  z.strictObject({ kind: z.literal("accept"), secret: z.string().regex(/^[A-Za-z0-9_-]{43}$/) }),
  z.strictObject({ kind: z.literal("invite"), tripId: id, role: z.enum(["VIEWER", "VOTER"]) }),
  z.strictObject({ kind: z.literal("revoke"), tripId: id, inviteId: id }),
  z.strictObject({
    kind: z.literal("vote"),
    tripId: id,
    editionId: id,
    choice: z.enum(["GOING", "MAYBE", "NOT_GOING"]).nullable(),
  }),
  z.strictObject({
    kind: z.literal("comment"),
    tripId: id,
    editionId: id,
    body: z.string().trim().min(1).max(500),
  }),
  z.strictObject({ kind: z.literal("remove-comment"), tripId: id, commentId: id }),
  z.strictObject({ kind: z.literal("leave"), tripId: id }),
  z.strictObject({ kind: z.literal("delete"), tripId: id }),
]);

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "private, no-store" } });
}

function failure(error: unknown) {
  if (!(error instanceof GroupTripError)) return json({ error: "unavailable" }, 500);
  return json({ error: error.code }, { missing: 404, invalid: 400, limit: 409 }[error.code]);
}

// Request bodies are small and can include a single-use secret. Never log them.
async function readAction(request: Request) {
  if (
    request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json"
  )
    return;
  const reader = request.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let length = 0;
  let body = "";
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > 4096) return;
      body += decoder.decode(chunk.value, { stream: true });
    }
    const parsed = action.safeParse(JSON.parse(body + decoder.decode()));
    return parsed.success ? parsed.data : undefined;
  } catch {
    return undefined;
  } finally {
    void reader.cancel().catch(() => undefined);
  }
}

export async function GET(request: Request) {
  const user = await requireUser();
  if (!user) return json({ error: "auth" }, 401);
  const tripId = new URL(request.url).searchParams.get("trip");
  if (tripId !== null && !id.safeParse(tripId).success) return json({ error: "invalid" }, 400);
  try {
    return json(
      tripId === null
        ? await listGroupTrips(db, user.id)
        : await readGroupTrip(db, user.id, tripId),
    );
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request: Request) {
  if (!requestHasTrustedOrigin(request)) return json({ error: "origin" }, 403);
  const user = await requireUser();
  if (!user) return json({ error: "auth" }, 401);
  const input = await readAction(request);
  if (!input) return json({ error: "invalid" }, 400);
  try {
    switch (input.kind) {
      case "create":
        return json(await createGroupTrip(db, user.id, input.title, input.editionIds), 201);
      case "accept":
        return json(await acceptGroupTripInvite(db, user.id, input.secret));
      case "invite":
        return json(await inviteToGroupTrip(db, user.id, input.tripId, input.role), 201);
      case "revoke":
        await revokeGroupTripInvite(db, user.id, input.tripId, input.inviteId);
        break;
      case "vote":
        await setGroupTripVote(db, user.id, input.tripId, input.editionId, input.choice);
        break;
      case "comment":
        await addGroupTripComment(db, user.id, input.tripId, input.editionId, input.body);
        break;
      case "remove-comment":
        await removeGroupTripComment(db, user.id, input.tripId, input.commentId);
        break;
      case "leave":
        await leaveGroupTrip(db, user.id, input.tripId);
        break;
      case "delete":
        await deleteGroupTrip(db, user.id, input.tripId);
        break;
    }
    return json({ ok: true });
  } catch (error) {
    return failure(error);
  }
}
