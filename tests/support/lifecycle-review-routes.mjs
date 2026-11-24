import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { transform } from "esbuild";
import { ADMIN_ROLES, roleAllowed } from "../../lib/admin-auth.ts";
const require = createRequire(import.meta.url);
// Execute the actual Next handlers. Only session/database boundaries are injected;
// an unexpected import cannot silently reach another service.
export async function loadReviewRoute(kind, dependencies) {
  const source = await readFile(
    new URL(`../../app/api/admin/edition-lifecycle/${kind}/[id]/route.ts`, import.meta.url),
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

// Real allowlist/role boundary, with only the session reader injected.
export async function loadCurrentAdmin(currentUser) {
  const source = await readFile(new URL("../../lib/admin-access.ts", import.meta.url), "utf8");
  const { code } = await transform(source, { loader: "ts", format: "cjs", target: "es2022" });
  const module = { exports: {} };
  new Function("require", "module", "exports", code)(
    (id) => {
      if (id === "@/lib/auth") return { currentUser };
      if (id === "@/lib/admin-auth") return { ADMIN_ROLES, roleAllowed };
      throw new Error(`Unexpected auth dependency: ${id}`);
    },
    module,
    module.exports,
  );
  return module.exports.currentAdmin;
}
