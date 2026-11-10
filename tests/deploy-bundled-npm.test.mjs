import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("installer invokes only the bundled npm for production dependencies", async () => {
  const installer = await readFile("scripts/deploy/install-release.sh", "utf8");
  assert.match(installer, /\.runtime\/node" "\$release\/\.runtime\/npm\/bin\/npm-cli\.js"/);
  assert.match(installer, /ci --omit=dev --ignore-scripts --no-audit --no-fund/);
  assert.doesNotMatch(installer, /^npm\s+ci/m);
  assert.ok(
    installer.indexOf(".runtime/npm/bin/npm-cli.js") <
      installer.indexOf("node_modules/prisma/build/index.js generate"),
    "bundled npm must install dependencies before Prisma activation",
  );
});

test("release bundles a working npm that needs no system npm on PATH", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "festival-radar-release-"));
  try {
    const application = path.join(temporary, "app");
    const runtime = path.join(application, ".runtime");
    await mkdir(application);
    await writeFile(
      path.join(application, "package.json"),
      JSON.stringify({ name: "portable-install-fixture", version: "1.0.0" }),
    );
    await writeFile(
      path.join(application, "package-lock.json"),
      JSON.stringify({
        name: "portable-install-fixture",
        version: "1.0.0",
        lockfileVersion: 3,
        packages: { "": { name: "portable-install-fixture", version: "1.0.0" } },
      }),
    );
    const packager = await readFile("scripts/deploy/package-release.sh", "utf8");
    assert.match(packager, /bundle-node-runtime\.sh" "\$stage\/app\/\.runtime"/);
    execFileSync("bash", [path.resolve("scripts/deploy/bundle-node-runtime.sh"), runtime], { env: process.env });
    assert.equal(
      execFileSync(path.join(runtime, "node"), ["--version"], { encoding: "utf8" }).trim(),
      "v" + (await readFile(".node-version", "utf8")).trim(),
    );
    const bundledVersion = execFileSync(
      path.join(runtime, "node"),
      [path.join(runtime, "npm", "bin", "npm-cli.js"), "--version"],
      { env: { PATH: "/nonexistent" }, encoding: "utf8" },
    ).trim();
    assert.equal(bundledVersion, (await readFile(path.join(runtime, "NPM_VERSION"), "utf8")).trim());
    execFileSync(
      path.join(runtime, "node"),
      [
        path.join(runtime, "npm", "bin", "npm-cli.js"),
        "ci",
        "--omit=dev",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
      ],
      { cwd: application, env: { PATH: "/nonexistent" } },
    );
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});

test("runtime packaging rejects a mismatched builder before creating the artifact", async () => {
  const temporary = await mkdtemp(path.join(os.tmpdir(), "runtime-mismatch-"));
  try {
    const { chmod, access } = await import("node:fs/promises");
    const fakeNode = path.join(temporary, "node");
    await writeFile(fakeNode, "#!/bin/sh\nprintf 'v22.23.4\\n'\n");
    await chmod(fakeNode, 0o755);
    const runtime = path.join(temporary, "artifact");
    assert.throws(() => execFileSync("bash", ["scripts/deploy/bundle-node-runtime.sh", runtime], {
      env: { ...process.env, PATH: temporary + path.delimiter + process.env.PATH },
      stdio: "pipe",
    }), /Node runtime mismatch/);
    await assert.rejects(access(runtime), { code: "ENOENT" });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});


test("installer preflights the archive runtime before any production mutation", async () => {
  const installer = await readFile("scripts/deploy/install-release.sh", "utf8");
  const start = installer.indexOf('runtime_preflight="$(mktemp -d)"');
  const end = installer.indexOf('install -d -m 0755 "$app_root/releases"');
  assert.ok(start > 0 && end > start);
  assert.ok(end < installer.indexOf('systemctl disable --now festival-radar-db-due.timer'));
  const preflight = installer.slice(start, end);
  const temporary = await mkdtemp(path.join(os.tmpdir(), "node-loader-"));
  try {
    const { chmod } = await import("node:fs/promises");
    const runtime = path.join(temporary, "app/.runtime");
    await mkdir(runtime, { recursive: true });
    const binary = path.join(runtime, "node");
    await writeFile(binary, "#!/bin/sh\necho 'libatomic.so.1: cannot open shared object file' >&2\nexit 127\n");
    await chmod(binary, 0o755);
    const archive = path.join(temporary, "release.tar.gz");
    execFileSync("tar", ["-czf", archive, "-C", temporary, "app"]);
    assert.throws(() => execFileSync("bash", ["-euc", preflight], {
      env: { ...process.env, archive, TMPDIR: temporary }, stdio: "pipe",
    }), /libatomic1/);
    await writeFile(binary, "#!/bin/sh\necho v26.13.0\n");
    execFileSync("tar", ["-czf", archive, "-C", temporary, "app"]);
    execFileSync("bash", ["-euc", preflight], { env: { ...process.env, archive, TMPDIR: temporary } });
  } finally {
    await rm(temporary, { recursive: true, force: true });
  }
});
