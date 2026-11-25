import type { PrismaClient } from "@prisma/client";

export function normalizeOriginName(name: string) {
  return name
    .normalize("NFKD")
    .toLowerCase()
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

export function normalizePostalCode(code: string) {
  return normalizeOriginName(code).replaceAll(" ", "");
}

export const geographicOriginSelect = {
  id: true,
  countryCode: true,
  name: true,
  region: true,
  postalCode: true,
  latitude: true,
  longitude: true,
} as const;

export async function searchOrigins(
  db: PrismaClient,
  input: { query: string; countryCode: string | null },
) {
  const searchName = normalizeOriginName(input.query);
  const postalKey = normalizePostalCode(input.query);
  const where = input.countryCode ? { countryCode: input.countryCode } : {};
  const [available, places] = await db.$transaction(
    [
      db.geographicOrigin.findFirst({ where, select: { id: true } }),
      db.geographicOrigin.findMany({
        where: {
          ...where,
          OR: [{ postalKey }, { postalCode: null, searchName: { startsWith: searchName } }],
        },
        orderBy: [
          { postalCode: "asc" },
          { searchName: "asc" },
          { countryCode: "asc" },
          { id: "asc" },
        ],
        select: geographicOriginSelect,
        take: 15,
      }),
    ],
    { isolationLevel: "RepeatableRead" },
  );
  return { available: Boolean(available), places };
}
