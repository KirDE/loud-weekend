import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { transform } from "esbuild";
const require = createRequire(import.meta.url);
// Execute the actual Next handlers. Only session/database boundaries are injected;
// an unexpected import cannot silently reach another service.
export async function loadReviewRoute(kind, dependencies) {
  const source = await readFile(
    new URL(`../../app/api/admin/ticket-offers/${kind}/[id]/route.ts`, import.meta.url),
    "utf8",
  );
  const { code } = await transform(source, { loader: "ts", format: "cjs", target: "es2022" });
  const module = { exports: {} };
  new Function("require", "module", "exports", code)(
    (id) => {
      if (id === "zod") return require("zod");
      if (!Object.hasOwn(dependencies, id)) throw new Error(`Unexpected route dependency: ${id}`);
      return dependencies[id];
    },
    module,
    module.exports,
  );
  return module.exports;
}
