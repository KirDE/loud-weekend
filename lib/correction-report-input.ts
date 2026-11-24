import { z } from "zod";

const slug = z
  .string()
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
  .max(180);
const base = z.object({
  slug,
  sourceUrl: z.string().trim().min(1).max(1024),
  notes: z.string().trim().max(500),
  website: z.literal(""),
});
export const correctionReportInput = z.discriminatedUnion("target", [
  base
    .extend({
      target: z.literal("edition"),
      year: z.number().int().min(1900).max(2200),
      kind: z.enum(["DATE", "LINEUP", "TICKETS"]),
    })
    .strict(),
  base.extend({ target: z.literal("artist"), kind: z.literal("IDENTITY") }).strict(),
]);
export type CorrectionReportInput = z.infer<typeof correctionReportInput>;

export function officialCorrectionUrl(value: string, knownUrls: (string | null)[]) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    url.protocol !== "https:" ||
    url.port ||
    url.username ||
    url.password ||
    url.search ||
    url.hash
  )
    return null;

  const trusted = knownUrls.some((known) => {
    if (!known) return false;
    try {
      const official = new URL(known);
      return (
        ["https:", "http:"].includes(official.protocol) &&
        official.hostname.replace(/^www\./, "") === url.hostname.replace(/^www\./, "")
      );
    } catch {
      return false;
    }
  });
  return trusted ? url.toString() : null;
}
