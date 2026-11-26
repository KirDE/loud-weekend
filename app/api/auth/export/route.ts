import { db } from "@/lib/db";
import { requireUser } from "@/lib/api";
import { rejectUntrustedOrigin } from "@/lib/request-origin";

const headers = {
  "Cache-Control": "private, no-store",
  "X-Content-Type-Options": "nosniff",
};

export async function POST(request: Request) {
  const denied = rejectUntrustedOrigin(request);
  if (denied) {
    denied.headers.set("Cache-Control", headers["Cache-Control"]);
    return denied;
  }

  const user = await requireUser();
  if (!user) return Response.json({ error: "Authentication required." }, { status: 401, headers });

  // Allowlist product data. Never load credential material, bearer links,
  // push secrets, delivery diagnostics or unrelated editorial records.
  const data = await db.user.findUnique({
    where: { id: user.id },
    select: {
      id: true,
      email: true,
      emailVerifiedAt: true,
      createdAt: true,
      updatedAt: true,
      documents: {
        orderBy: { kind: "asc" },
        select: { kind: true, payload: true, revision: true, createdAt: true, updatedAt: true },
      },
      runningOrders: {
        orderBy: [{ edition: { festival: { slug: "asc" } } }, { edition: { year: "asc" } }],
        select: {
          revision: true,
          performanceIds: true,
          edition: { select: { year: true, festival: { select: { slug: true } } } },
        },
      },
      passkeys: {
        orderBy: { createdAt: "asc" },
        select: { deviceType: true, backedUp: true, createdAt: true, lastUsedAt: true },
      },
      shareLinks: {
        where: { document: { userId: user.id } },
        orderBy: { createdAt: "asc" },
        select: { createdAt: true, expiresAt: true, document: { select: { kind: true } } },
      },
      spotify: {
        select: { spotifyUserId: true, lastSyncedAt: true, createdAt: true, updatedAt: true },
      },
      notificationPreferences: {
        orderBy: { createdAt: "asc" },
        select: {
          festivalId: true,
          eventType: true,
          channel: true,
          frequency: true,
          enabled: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      notificationSubscriptions: {
        orderBy: { createdAt: "asc" },
        select: { channel: true, enabled: true, createdAt: true, updatedAt: true },
      },
      notificationDeliveries: {
        orderBy: { createdAt: "asc" },
        select: {
          channel: true,
          frequency: true,
          status: true,
          createdAt: true,
          sentAt: true,
          event: { select: { festivalId: true, type: true, occurredAt: true } },
        },
      },
    },
  });
  if (!data) return Response.json({ error: "Authentication required." }, { status: 401, headers });

  return Response.json(
    {
      version: 1,
      exportedAt: new Date().toISOString(),
      account: data,
    },
    {
      headers: {
        ...headers,
        "Content-Disposition": 'attachment; filename="loud-weekend-account-data.json"',
      },
    },
  );
}
