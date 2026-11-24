import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export const MAX_LINE_LENGTH = 120;
const sourceExtensions = new Set([
  ".js",
  ".mjs",
  ".cjs",
  ".ts",
  ".tsx",
  ".jsx",
  ".mts",
  ".cts",
  ".css",
  ".py",
  ".sh",
  ".yml",
  ".yaml",
  ".prisma",
]);

export function isSourceFile(filename) {
  // Payload formats are not source; executable fixtures remain covered. Applied SQL migrations are immutable.
  return (
    (sourceExtensions.has(path.extname(filename)) ||
      (filename.startsWith("scripts/") && path.extname(filename) === "")) &&
    !/^(?:public\/vendor|node_modules|\.next|out)\//.test(filename)
  );
}

export function lineViolations(filename, source) {
  return source.split(/\r?\n/).flatMap((line, index) => {
    const length = Array.from(line.replaceAll("\t", "    ")).length;
    return length > MAX_LINE_LENGTH ? [{ filename, line: index + 1, length }] : [];
  });
}

export function checkRepository(root = process.cwd()) {
  const names = execFileSync(
    "git",
    ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
    {
      cwd: root,
      encoding: "utf8",
    },
  )
    .split("\0")
    .filter(Boolean);
  return [...new Set(names)].filter(isSourceFile).flatMap((filename) => {
    const absolute = path.join(root, filename);
    // Do not follow links or read paths outside this checkout.
    if (!existsSync(absolute) || !lstatSync(absolute).isFile()) return [];
    return lineViolations(filename, readFileSync(absolute, "utf8"));
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const violations = checkRepository();
  for (const { filename, line, length } of violations) {
    console.error(`${filename}:${line}: ${length} characters (maximum ${MAX_LINE_LENGTH})`);
  }
  console.log(
    `Line length: ${violations.length} violations; all maintained source checked, no legacy baseline.`,
  );
  process.exitCode = violations.length ? 1 : 0;
}
