import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkRepository, isSourceFile, lineViolations } from "../scripts/check-line-length.mjs";

test("120 characters pass; 121 fail, including non-ASCII and CRLF", () => {
  assert.deepEqual(lineViolations("a.ts", "я".repeat(120) + "\r\n"), []);
  assert.deepEqual(lineViolations("a.py", "🙂".repeat(121)), [
    { filename: "a.py", line: 1, length: 121 },
  ]);
  assert.equal(lineViolations("a.css", "\t" + "x".repeat(117))[0].length, 121);
});

test("all maintained source is covered; data and immutable migration history are not reformatted", () => {
  for (const name of [
    "app/a.tsx",
    "app/a.jsx",
    "lib/a.mts",
    "lib/a.cts",
    "scripts/deploy/start-db-due",
    "scripts/a.py",
    "tests/fixtures/fileless-provider.py",
    "tests/fixtures/youtube-db-provider.py",
    "tests/fixtures/page.js",
    "scripts/a.sh",
    ".github/workflows/quality.yml",
  ]) {
    assert.equal(isSourceFile(name), true, name);
  }
  for (const name of [
    "tests/fixtures/page.html",
    "public/vendor/a.js",
    "package-lock.json",
    "prisma/migrations/a.sql",
  ]) {
    assert.equal(isSourceFile(name), false, name);
  }
});

test("checker detects old tracked and new untracked violations without a baseline", () => {
  const root = mkdtempSync(path.join(os.tmpdir(), "lw-line-length-"));
  try {
    execFileSync("git", ["init", "--quiet", root]);
    writeFileSync(path.join(root, "old.ts"), "x".repeat(121));
    execFileSync("git", ["add", "old.ts"], { cwd: root });
    writeFileSync(path.join(root, "new.py"), "x".repeat(122));
    mkdirSync(path.join(root, "tests", "fixtures"), { recursive: true });
    writeFileSync(path.join(root, "tests", "fixtures", "page.js"), "x".repeat(200));
    assert.deepEqual(
      checkRepository(root)
        .map(({ filename }) => filename)
        .sort(),
      ["new.py", "old.ts", "tests/fixtures/page.js"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
