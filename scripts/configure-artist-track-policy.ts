import { db } from "../lib/db.ts";
import {
  activateArtistTrackPolicyMigration,
  publishArtistTrackPolicy,
} from "../lib/catalog/artist-track-policy-repository.ts";

const args = process.argv.slice(2);
if (
  args.some((arg) => !["--apply", "--activate"].includes(arg)) ||
  new Set(args).size !== args.length
)
  throw new Error("Only --apply and --activate are supported");
try {
  const parts: Buffer[] = [];
  let size = 0;
  for await (const part of process.stdin) {
    size += part.length;
    if (size > 64 * 1024) throw new Error("Track policy submission too large");
    parts.push(part);
  }
  const value = JSON.parse(Buffer.concat(parts).toString("utf8"));
  const publish = args.includes("--activate")
    ? activateArtistTrackPolicyMigration
    : publishArtistTrackPolicy;
  console.log(JSON.stringify(await publish(db, value, args.includes("--apply"))));
} finally {
  await db.$disconnect();
}
