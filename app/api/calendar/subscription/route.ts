import { requireUser } from "@/lib/api";
import { calendarPrivateHeaders, issueCalendarKey } from "@/lib/calendar-subscription";
import { db } from "@/lib/db";
import { requestHasTrustedOrigin } from "@/lib/request-origin";

const reply = (body: object, status = 200) =>
  Response.json(body, { status, headers: calendarPrivateHeaders });

export async function GET() {
  const user = await requireUser();
  if (!user) return reply({ error: "Authentication required." }, 401);
  const subscription = await db.calendarSubscription.findUnique({
    where: { userId: user.id },
    select: { userId: true },
  });
  return reply({
    active: Boolean(subscription),
    available: process.env.CALENDAR_SUBSCRIPTIONS_ENABLED === "1",
  });
}

export async function POST(request: Request) {
  if (!requestHasTrustedOrigin(request)) return reply({ error: "Untrusted request origin." }, 403);
  const user = await requireUser();
  if (!user) return reply({ error: "Authentication required." }, 401);
  if (process.env.CALENDAR_SUBSCRIPTIONS_ENABLED !== "1")
    return reply({ error: "Subscriptions unavailable." }, 503);
  const key = await issueCalendarKey(db, user.id);
  if (!key) return reply({ error: "No current seasons available." }, 409);
  return reply({ active: true, key }, 201);
}

export async function DELETE(request: Request) {
  if (!requestHasTrustedOrigin(request)) return reply({ error: "Untrusted request origin." }, 403);
  const user = await requireUser();
  if (!user) return reply({ error: "Authentication required." }, 401);
  await db.calendarSubscription.deleteMany({ where: { userId: user.id } });
  return reply({ active: false });
}
