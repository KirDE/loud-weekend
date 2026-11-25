import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { normalizeOriginName, normalizePostalCode } from "../lib/origin-gazetteer.ts";

const flags = process.argv.slice(2);
const argument = (name) =>
  flags.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const countryCode = argument("country");
const paths = { city: argument("places"), postal: argument("postal") };
const apply = flags.includes("--apply");
if (
  !/^[A-Z]{2}$/.test(countryCode ?? "") ||
  !paths.city ||
  !paths.postal ||
  (apply && !process.env.DATABASE_URL)
) {
  throw new Error(
    "Specify --country=DE, --places=places.txt and --postal=postal.txt; --apply requires DATABASE_URL",
  );
}

function row(line, kind) {
  const fields = line.split("\t");
  const city = kind === "city";
  if (fields.length !== (city ? 19 : 12)) throw new Error(`Unexpected ${kind} schema`);
  const country = fields[city ? 8 : 0];
  if (country !== countryCode) throw new Error("The input contains a different country");
  if (city && (fields[6] !== "P" || ["PPLH", "PPLQ", "PPLW", "PPLX"].includes(fields[7])))
    return null;
  if (city && !/^\d+$/.test(fields[0])) throw new Error("Invalid GeoNames ID");
  const name = fields[city ? 1 : 2].trim();
  const searchName = normalizeOriginName(name);
  const postalCode = city ? null : fields[1].trim();
  const postalKey = postalCode ? normalizePostalCode(postalCode) : null;
  const region = city ? fields[10].trim() : fields[3].trim();
  const coordinates = fields.slice(city ? 4 : 9, city ? 6 : 11);
  const [latitude, longitude] = coordinates.map(Number);
  if (
    !name ||
    !searchName ||
    name.length > 150 ||
    region.length > 150 ||
    (!city && (!postalKey || postalCode.length > 30)) ||
    coordinates.some((value) => !value.trim()) ||
    !Number.isFinite(latitude) ||
    Math.abs(latitude) > 90 ||
    !Number.isFinite(longitude) ||
    Math.abs(longitude) > 180
  )
    throw new Error(`Invalid ${kind} row`);
  const id = city
    ? `gn:${fields[0]}`
    : "postal:" +
      createHash("sha256")
        .update(JSON.stringify([country, postalKey, name, region, latitude, longitude]))
        .digest("hex");
  return {
    id,
    countryCode,
    name,
    searchName,
    region: region || null,
    postalCode,
    postalKey,
    latitude,
    longitude,
  };
}

async function load(tx) {
  const counts = { city: 0, postal: 0 };
  for (const [kind, path] of Object.entries(paths)) {
    const lines = createInterface({ input: createReadStream(path), crlfDelay: Infinity });
    let batch = [];
    for await (const line of lines) {
      if (!line) continue;
      const place = row(line, kind);
      if (!place) continue;
      counts[kind]++;
      if (!tx) continue;
      batch.push(place);
      if (batch.length >= 500) {
        await tx.geographicOrigin.createMany({ data: batch, skipDuplicates: true });
        batch = [];
      }
    }
    if (tx && batch.length)
      await tx.geographicOrigin.createMany({ data: batch, skipDuplicates: true });
    if (!counts[kind]) throw new Error(`No valid ${kind} records supplied`);
  }
  return counts;
}

if (apply) {
  const { db } = await import("../lib/db.ts");
  try {
    const result = await db.$transaction(
      async (tx) => {
        // Serialize country refreshes, leaving the prior generation intact on failure.
        await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${"gazetteer:" + countryCode}))::text`;
        await tx.geographicOrigin.deleteMany({ where: { countryCode } });
        return load(tx);
      },
      { timeout: 600_000 },
    );
    console.log(JSON.stringify({ countryCode, applied: true, ...result }));
  } finally {
    await db.$disconnect();
  }
} else {
  console.log(JSON.stringify({ countryCode, applied: false, ...(await load(null)) }));
}
