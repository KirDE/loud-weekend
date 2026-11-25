import { calendarPrivateHeaders, readCalendarFeed } from "@/lib/calendar-subscription";
import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const keys = new URL(request.url).searchParams.getAll("key");
  const calendar =
    process.env.CALENDAR_SUBSCRIPTIONS_ENABLED === "1" && keys.length === 1
      ? await readCalendarFeed(db, keys[0])
      : null;
  if (calendar === null)
    return new Response("Not Found", { status: 404, headers: calendarPrivateHeaders });
  return new Response(calendar, {
    headers: { ...calendarPrivateHeaders, "Content-Type": "text/calendar; charset=utf-8" },
  });
}
