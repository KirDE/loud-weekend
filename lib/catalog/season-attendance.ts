import { z } from "zod";
import type { PrismaClient } from "@prisma/client";
import { seasonAttendanceKey } from "../planner-storage";

const payload = z
  .object({
    seasonAttendance: z
      .record(z.string().regex(seasonAttendanceKey), z.enum(["going", "maybe", "not-going"]))
      .refine((entries) => Object.keys(entries).length <= 1000),
  })
  .strict();

export async function verifiedSeasonAttendance(
  db: PrismaClient,
  value: unknown,
  previous: unknown,
) {
  const parsed = payload.safeParse(value);
  if (!parsed.success) return null;
  const prior = payload.safeParse(previous);
  // Retain existing entries when their edition is no longer listed. New entries
  // must correspond to exact editions that the public season pages can show.
  const newKeys = Object.keys(parsed.data.seasonAttendance).filter(
    (key) => !prior.success || !(key in prior.data.seasonAttendance),
  );
  if (!newKeys.length) return parsed.data;
  const editions = await db.festivalEdition.count({
    where: {
      AND: [
        {
          OR: newKeys.map((key) => ({
            year: Number(key.slice(0, 4)),
            festival: { slug: key.slice(5) },
          })),
        },
        {
          OR: [
            { recordState: "ARCHIVED", snapshotAt: { not: null } },
            { recordState: "CURRENT" },
            { recordState: "TRACKING", provenance: { some: { field: "edition" } } },
          ],
        },
      ],
    },
  });
  return editions === newKeys.length ? parsed.data : null;
}
