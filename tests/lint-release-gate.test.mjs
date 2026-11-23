import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import test from "node:test";

test("failed, cancelled, skipped or absent lint cannot pass the aggregate release check", () => {
  const workflow = readFileSync(
    new URL("../.github/workflows/quality.yml", import.meta.url),
    "utf8",
  );
  const aggregate = workflow.slice(workflow.indexOf("  test-and-build:"));
  assert.match(aggregate, /needs: \[lint, core, browser-tests\]/);
  assert.match(aggregate, /LINT_RESULT: \$\{\{ needs\.lint\.result \}\}/);
  const commands = aggregate.match(/run: \|\n([\s\S]*)$/)?.[1];
  assert.ok(commands, "the actual aggregate job commands must be present");
  for (const lint of ["success", "failure", "cancelled", "skipped", ""]) {
    const result = spawnSync("bash", ["-e", "-c", commands], {
      env: { ...process.env, LINT_RESULT: lint, CORE_RESULT: "success", BROWSER_RESULT: "success" },
    });
    assert.equal(result.status === 0, lint === "success", `lint=${lint || "absent"}`);
  }
});
