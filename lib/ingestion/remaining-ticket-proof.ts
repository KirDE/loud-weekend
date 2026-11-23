import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import type { FestivalSource } from "./types.ts";

const slugKinds = {
  "jera-on-air": "jera",
  "2000trees": "trees",
  pinkpop: "pinkpop",
  eurockeennes: "eurockeennes",
} as const;

const primaryUrls: Record<keyof typeof slugKinds, readonly string[]> = {
  "jera-on-air": [
    "https://www.jeraonair.nl/en/info/",
    "https://www.jeraonair.nl/en/line-up/"
  ],
  "2000trees": [
    "https://2000trees.co.uk/"
  ],
  "pinkpop": [
    "https://www.pinkpop.nl/"
  ],
  "eurockeennes": [
    "https://www.eurockeennes.fr/"
  ]
};

const text = z.string().min(1);
const numericId = z.string().regex(/^\d+$/);
const schema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("jera"), handle: z.string().regex(/^jera-on-air-[a-z0-9-]+-weekend-ticket$/), title: text, sku: text }).strict(),
  z.object({ kind: z.literal("trees"), eventName: text, eventStart: z.iso.datetime({ offset: true }), eventEnd: z.iso.datetime({ offset: true }), shopId: numericId, checkoutId: numericId }).strict(),
  z.object({ kind: z.literal("pinkpop"), title: text, onSale: text, ticketmasterId: numericId }).strict(),
  z.object({ kind: z.literal("eurockeennes"), titlePrefix: text, cardClass: z.string().regex(/^lkbill\d+$/), widgetId: z.uuid() }).strict(),
]);

export type RemainingProof = z.infer<typeof schema> & { sourceUrl: string; editionYear: number };

function kindForSource(source: FestivalSource) {
  if (!Object.hasOwn(slugKinds, source.festivalSlug) || source.fetchUrl || source.followLinkPattern || source.strategies.includes("manual_review")) return;
  const slug = source.festivalSlug as keyof typeof slugKinds;
  if (primaryUrls[slug].includes(source.url)) return slugKinds[slug];
}

export function getRemainingProof(source: FestivalSource): RemainingProof | undefined {
  const proof = source.remainingProof;
  if (proof && kindForSource(source) === proof.kind && proof.sourceUrl === source.url && proof.editionYear === source.editionYear) return proof;
}

export async function withRemainingProof<T extends FestivalSource>(db: Pick<PrismaClient, "$queryRaw">, source: T): Promise<T> {
  const kind = kindForSource(source);
  if (!kind) return source;
  const [row] = await db.$queryRaw<{ proof: unknown }[]>`
    SELECT "proof" FROM "ReviewedTicketProof"
    WHERE "festivalSlug" = ${source.festivalSlug} AND "sourceUrl" = ${source.url} AND "editionYear" = ${source.editionYear}
  `;
  if (!row) return source;
  const proof = schema.parse(row.proof);
  if (proof.kind !== kind) throw new Error("Reviewed stock proof does not match the selected source");
  return { ...source, remainingProof: { ...proof, sourceUrl: source.url, editionYear: source.editionYear } };
}
