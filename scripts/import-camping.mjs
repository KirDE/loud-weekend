import { parseArgs } from "node:util";
import { db } from "../lib/db.ts";
import { collectReviewedCamping } from "../lib/ingestion/camping-collector.ts";

try {
  const { values } = parseArgs({
    options: {
      festival: { type: "string" },
      edition: { type: "string" },
      apply: { type: "string" },
      actor: { type: "string" },
    },
  });
  if (
    !values.festival ||
    !values.edition ||
    !process.env.DATABASE_URL ||
    (values.apply && !values.actor?.trim())
  ) {
    throw new Error(
      "Use DATABASE_URL, --festival=<slug> and --edition=YYYY; apply also requires --actor=<label>",
    );
  }
  console.log(
    JSON.stringify(
      await collectReviewedCamping(db, values.festival, Number(values.edition), {
        approval: values.apply,
        actorLabel: values.actor,
      }),
    ),
  );
} finally {
  await db.$disconnect();
}
