import { db } from "../lib/db.ts";
import { publishArtistTrackPolicy } from "../lib/catalog/artist-track-policy-repository.ts";

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== "--apply"))
  throw new Error("Only --apply is supported");
try {
  const parts: Buffer[] = [];
  let size = 0;
  for await (const part of process.stdin) {
    size += part.length;
    if (size > 64 * 1024) throw new Error("Track policy submission too large");
    parts.push(part);
  }
  const value = JSON.parse(Buffer.concat(parts).toString("utf8"));
  console.log(JSON.stringify(await publishArtistTrackPolicy(db, value, args.includes("--apply"))));
} finally {
  await db.$disconnect();
}
