import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import stylelint from "stylelint";

const root = path.resolve(import.meta.dirname, "..");

test("Stylelint still rejects new descending-specificity conflicts outside local exceptions", async () => {
  const result = await stylelint.lint({
    code: ".outer .inner { color: red; }\n.inner { color: blue; }\n",
    codeFilename: path.join(root, "app", "regression.css"),
    configFile: path.join(root, ".stylelintrc.json"),
  });
  assert.ok(result.results[0].warnings.some(({ rule }) => rule === "no-descending-specificity"));
});

test("Oxlint rejects a new useless spread rather than globally suppressing correctness rules", () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), "lw-oxlint-"));
  try {
    const filename = path.join(dir, "regression.js");
    writeFileSync(filename, "for (const item of [...new Set([1, 2])]) console.log(item);\n");
    const result = spawnSync(
      path.join(root, "node_modules", ".bin", "oxlint"),
      ["--config", path.join(root, ".oxlintrc.json"), "--format", "json", filename],
      { encoding: "utf8", cwd: root },
    );
    assert.equal(result.status, 1);
    assert.ok(
      JSON.parse(result.stdout).diagnostics.some(
        ({ code }) => code === "unicorn(no-useless-spread)",
      ),
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("required lint includes Prettier check with matching write/check source coverage", () => {
  const { scripts } = JSON.parse(readFileSync(path.join(root, "package.json"), "utf8"));
  assert.match(scripts.lint, /(?:^|&&\s*)npm run lint:format(?:\s*&&|$)/);
  assert.equal(scripts.format.replace("--write", "--check"), scripts["lint:format"]);
  for (const ext of ["jsx", "mts", "cts"]) assert.ok(scripts["lint:format"].includes(ext));
  const result = spawnSync(
    path.join(root, "node_modules", ".bin", "prettier"),
    ["--check", "--stdin-filepath", path.join(root, "app", "regression.mts")],
    { cwd: root, encoding: "utf8", input: "export const x={a:1};\n" },
  );
  assert.equal(result.status, 1, result.stderr);
});
