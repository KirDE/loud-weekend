import { Prisma, type PrismaClient } from "@prisma/client";
import { artistAliasIndex } from "./artist-aliases.ts";

/** Explicitly verified aliases only. Source strings never teach arbitrary aliases. */
export async function addArtistAliases(
  db: PrismaClient,
  input: {
    slug: string;
    aliases: string[];
    actorLabel: string;
    evidence: string;
  },
) {
  if (!input.actorLabel.trim() || !input.evidence.trim())
    throw new Error("Alias actor and verification evidence required");
  const aliases = input.aliases.map((value) => value.trim());
  if (
    !aliases.length ||
    // oxlint-disable-next-line no-control-regex -- Reject untrusted C0 control characters.
    aliases.some((value) => !value || value.length > 200 || /[\u0000-\u001f]/.test(value))
  )
    throw new Error("Invalid artist aliases");
  return db.$transaction(
    async (tx) => {
      const artists = await tx.artist.findMany({
        select: { id: true, slug: true, name: true, aliases: true },
      });
      const target = artists.find((artist) => artist.slug === input.slug);
      if (!target) throw new Error("Unknown artist slug");
      const lookup = artistAliasIndex(artists, { orthography: true });
      for (const name of aliases)
        if (lookup(name).some((owner) => owner.id !== target.id))
          throw new Error(`Artist alias collision: ${name}`);
      const next = [
        ...new Set([...target.aliases, ...aliases.filter((name) => name !== target.name)]),
      ];
      if (JSON.stringify(next) === JSON.stringify(target.aliases))
        return { ...target, changed: false };
      await tx.artist.update({ where: { id: target.id }, data: { aliases: next } });
      await tx.adminAuditEntry.create({
        data: {
          actorLabel: input.actorLabel,
          action: "artist.aliases.add",
          resourceKind: "ARTIST",
          resourceKey: target.slug,
          beforeValue: target.aliases,
          afterValue: next,
          evidence: { verification: input.evidence },
        },
      });
      return { ...target, aliases: next, changed: true };
    },
    { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
  );
}
