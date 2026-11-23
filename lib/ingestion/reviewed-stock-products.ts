import type { PrismaClient } from "@prisma/client";
import { z } from "zod";

const productSchema = z.object({
  title: z.string().min(1),
  start: z.iso.datetime({ offset: true }),
  end: z.iso.datetime({ offset: true }),
  price: z.string().regex(/^\d+(?:\.\d{2})?$/),
  pageTitle: z.string().min(1),
  visiblePrice: z.string().min(1),
}).strict();

export async function readReviewedStockProduct(db: Pick<PrismaClient, "$queryRaw">, sourceUrl: string, editionYear: number) {
  const [row] = await db.$queryRaw<{ assertions: unknown }[]>`
    SELECT "assertions" FROM "ReviewedStockProduct"
    WHERE "sourceUrl" = ${sourceUrl} AND "editionYear" = ${editionYear}
  `;
  const product = productSchema.safeParse(row?.assertions);
  if (!product.success || Date.parse(product.data.end) <= Date.parse(product.data.start))
    throw new Error("Reviewed ticket product missing or invalid");
  return product.data;
}
