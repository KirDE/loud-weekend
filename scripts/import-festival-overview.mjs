import { parseArgs } from "node:util";
import { db } from "../lib/db.ts";
import { collectReviewedOverview } from "../lib/ingestion/overview-collector.ts";

try {
  const { values } = parseArgs({
    options: {
      festival: { type: "string" },
      edition: { type: "string" },
      apply: { type: "string" },
    },
  });
  if (!values.festival || !values.edition || !process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL, --festival=<slug> and --edition=YYYY required; --apply=<preview fingerprint> writes",
    );
  }
  const result = await collectReviewedOverview(db, values.festival, Number(values.edition), {
    approval: values.apply,
  });
  console.log(JSON.stringify(result));
} finally {
  await db.$disconnect();
}
