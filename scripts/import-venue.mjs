import { parseArgs } from "node:util";
import { db } from "../lib/db.ts";
import { collectReviewedVenue } from "../lib/ingestion/venue-collector.ts";

try {
  const { values } = parseArgs({
    options: { edition: { type: "string" }, apply: { type: "string" }, actor: { type: "string" } },
  });
  if (!values.edition || !process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL and --edition=YYYY are required. Publish with --apply=<token> --actor=<operator>.",
    );
  }
  console.log(
    JSON.stringify(
      await collectReviewedVenue(db, Number(values.edition), {
        approval: values.apply,
        actor: values.actor,
      }),
    ),
  );
} finally {
  await db.$disconnect();
}
