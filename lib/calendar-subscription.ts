import { createHash, randomBytes } from "node:crypto";
import type { PrismaClient } from "@prisma/client";
import { calendarFile } from "./planning.ts";

export const calendarPrivateHeaders = {
  "Cache-Control": "private, no-store",
  "Referrer-Policy": "no-referrer",
  "X-Content-Type-Options": "nosniff",
  "X-Robots-Tag": "noindex, nofollow, noarchive",
};

const digestKey = (key: string) => createHash("sha256").update(key).digest("hex");

// Slug-only FESTIVAL_PLANS choices belong to the original 2027 planner.
const legacyPlannerYear = 2027;

export async function issueCalendarKey(db: PrismaClient, userId: string) {
  const available = await db.festivalEdition.findFirst({
    where: { recordState: "CURRENT", year: legacyPlannerYear },
    select: { id: true },
  });
  if (!available) return null;
  const key = randomBytes(32).toString("base64url");
  const data = { keyDigest: digestKey(key), seasons: [legacyPlannerYear], createdAt: new Date() };
  await db.calendarSubscription.upsert({
    where: { userId },
    create: { userId, ...data },
    update: data,
  });
  return key;
}

const isoDate = (date: Date | null) => date?.toISOString().slice(0, 10);

export async function readCalendarFeed(db: PrismaClient, key: string) {
  if (!/^[A-Za-z0-9_-]{43}$/.test(key)) return null;
  // Read authorization, synced choices, and catalogue dates from the same snapshot.
  return db.$transaction(
    async (tx) => {
      const subscription = await tx.calendarSubscription.findUnique({
        where: { keyDigest: digestKey(key) },
        select: { userId: true, seasons: true },
      });
      if (!subscription) return null;
      if (!subscription.seasons.includes(legacyPlannerYear)) return calendarFile([]);
      const plans = await tx.syncDocument.findUnique({
        where: { userId_kind: { userId: subscription.userId, kind: "FESTIVAL_PLANS" } },
        select: { payload: true },
      });
      const payload = plans?.payload;
      const attendance =
        payload && typeof payload === "object" && !Array.isArray(payload)
          ? payload.attendance
          : null;
      const slugs =
        attendance && typeof attendance === "object" && !Array.isArray(attendance)
          ? Object.entries(attendance)
              .filter(([, value]) => value === "going" || value === "maybe")
              .map(([slug]) => slug)
          : [];
      if (!slugs.length) return calendarFile([]);

      const editions = await tx.festivalEdition.findMany({
        where: {
          recordState: "CURRENT",
          year: legacyPlannerYear,
          startDate: { not: null },
          festival: { slug: { in: slugs } },
        },
        select: {
          id: true,
          year: true,
          startDate: true,
          endDate: true,
          updatedAt: true,
          festival: {
            select: {
              slug: true,
              name: true,
              city: true,
              country: true,
              officialUrl: true,
              updatedAt: true,
            },
          },
        },
        orderBy: [{ startDate: "asc" }, { id: "asc" }],
      });
      const events = editions.map(({ festival, ...edition }) => {
        const updatedAt =
          festival.updatedAt > edition.updatedAt ? festival.updatedAt : edition.updatedAt;
        return {
          slug: festival.slug,
          name: festival.name,
          city: festival.city ?? undefined,
          country: festival.country,
          officialUrl: festival.officialUrl,
          editionYear: edition.year,
          startDate: isoDate(edition.startDate),
          endDate: isoDate(edition.endDate),
          calendarId: edition.id,
          calendarUpdatedAt: updatedAt.toISOString(),
        };
      });
      return calendarFile(events);
    },
    { isolationLevel: "RepeatableRead" },
  );
}
