import { db } from "../lib/db.ts";
import { addArtistAliases } from "../lib/catalog/artist-alias-repository.ts";
const args = process.argv.slice(2);
const one = (key) => args.find((arg) => arg.startsWith(`--${key}=`))?.slice(key.length + 3);
if (args.some((arg) => !/^--(?:slug|alias|actor|evidence)=/.test(arg)))
  throw new Error("Unknown alias option");
const slug = one("slug");
const actorLabel = one("actor");
const evidence = one("evidence");
if (!slug || !actorLabel || !evidence)
  throw new Error("--slug, --alias, --actor and --evidence required");
try {
  console.log(
    JSON.stringify(
      await addArtistAliases(db, {
        slug,
        aliases: args.filter((arg) => arg.startsWith("--alias=")).map((arg) => arg.slice(8)),
        actorLabel,
        evidence,
      }),
    ),
  );
} finally {
  await db.$disconnect();
}
