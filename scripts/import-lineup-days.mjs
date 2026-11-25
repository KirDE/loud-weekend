import { readFile } from "node:fs/promises";
import { importLineupDays } from "../lib/catalog/lineup-days-import.ts";

const args = process.argv.slice(2);
const inputs = args.filter((arg) => arg.startsWith("--input="));
if (
  !process.env.DATABASE_URL ||
  inputs.length !== 1 ||
  !inputs[0].slice(8) ||
  args.some((arg) => arg !== inputs[0] && arg !== "--apply")
) {
  throw new Error(
    "DATABASE_URL and --input=/path/to/reviewed.json required; default is preview, --apply writes",
  );
}

const document = JSON.parse(await readFile(inputs[0].slice(8), "utf8"));
const { db } = await import("../lib/db.ts");
try {
  console.log(JSON.stringify(await importLineupDays(db, document, !args.includes("--apply"))));
} finally {
  await db.$disconnect();
}
