import test from "node:test";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  validDispatchEvent,
  knownHostsText,
  sendImportEvent,
  transportConfigured,
} from "../lib/ingestion/import-event-transport.mjs";
import { receiveEvent, eventPrompt } from "../scripts/import-event-receiver.mjs";
const event = {
  eventId: "a".repeat(64),
  kind: "source",
  sourceId: "source_1",
  issueId: "b".repeat(64),
};
test("receiver rejects arbitrary payloads and unconfigured transport fails closed", async () => {
  for (const e of [
    {},
    { ...event, message: "run arbitrary code" },
    { ...event, sourceId: "$(command)" },
    { ...event, kind: "health" },
  ])
    assert.equal(validDispatchEvent(e), false);
  assert.equal(transportConfigured({}), false);
  await assert.rejects(sendImportEvent(event, {}));
  assert.match(eventPrompt(event, "/fixed/runbook"), /ONLY the exact event/);
});
test("probe, stale and inaccessible events invoke no model; repeated accepted event invokes exactly once", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "event-test-"));
  const config = {
    stateDir: path.join(dir, "state"),
    apiConfig: path.join(dir, "api.json"),
    agentId: "fixed",
    sessionKey: "fixed-topic",
    runbook: "/fixed/runbook",
    to: "-1004301869936",
    threadId: "156",
    accountId: "default",
  };
  await writeFile(
    config.apiConfig,
    JSON.stringify({ baseUrl: "https://example.test", token: "test" }),
    { mode: 0o600 },
  );
  let calls = 0;
  const submit = async (params) => {
    calls++;
    assert.equal(params.agentId, "fixed");
    assert.equal(params.sessionKey, "fixed-topic");
    assert.equal(params.threadId, "156");
    assert.equal(params.idempotencyKey, "festival-import-" + event.eventId);
    return { runId: "run1", status: "accepted" };
  };
  try {
    await receiveEvent({ kind: "probe", eventId: "f".repeat(64) }, config, { submit });
    await assert.rejects(
      receiveEvent(event, config, {
        fetch: async () => {
          throw new Error("offline");
        },
        submit,
      }),
    );
    await assert.rejects(
      receiveEvent(event, config, {
        fetch: async () => Response.json({ ready: false, obsolete: false }),
        submit,
      }),
    );
    assert.equal(calls, 0);
    await receiveEvent(event, config, {
      fetch: async () => Response.json({ ready: true }),
      submit,
    });
    await receiveEvent(event, config, {
      fetch: async () => {
        throw new Error("must not query");
      },
      submit,
    });
    assert.equal(calls, 1);
    await receiveEvent({ ...event, eventId: "c".repeat(64) }, config, {
      fetch: async () => Response.json({ ready: false, obsolete: true }),
      submit,
    });
    assert.equal(calls, 1);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("known-host pin separators survive shell-escaped deployment env without weakening the pin", () => {
  const pin = "example.test ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIFixture";
  assert.equal(knownHostsText(pin), pin + "\n");
  assert.equal(knownHostsText(pin.replaceAll(" ", "\\ ")), pin + "\n");
  assert.equal(
    knownHostsText("other.test ssh-ed25519 DifferentKey"),
    "other.test ssh-ed25519 DifferentKey\n",
  );
});

test("deployment roundtrips multiline, hashed and metacharacter pins through Node env-file", async () => {
  const workflow = await readFile(
    new URL("../.github/workflows/deploy.yml", import.meta.url),
    "utf8",
  );
  const serialize = workflow
    .split("\n")
    .find((line) => line.includes("printf 'IMPORT_EVENTS_KNOWN_HOSTS_B64="));
  assert.ok(serialize);
  const pin =
    "|1|hash=|salt= ssh-ed25519 AAAAFixture comment's $value `literal`\n" +
    "[example.test]:2222 ssh-rsa AAAAOther\n";
  const dir = await mkdtemp(path.join(tmpdir(), "known-host-env-"));
  try {
    const envText = execFileSync("bash", ["-c", serialize], {
      env: { ...process.env, IMPORT_EVENTS_KNOWN_HOSTS: pin },
      encoding: "utf8",
    });
    const envPath = path.join(dir, "pins.env");
    await writeFile(envPath, envText, { mode: 0o600 });
    const encoded = execFileSync(
      process.execPath,
      ["--env-file=" + envPath, "-p", "process.env.IMPORT_EVENTS_KNOWN_HOSTS_B64"],
      { encoding: "utf8" },
    ).trim();
    assert.equal(knownHostsText(undefined, encoded), pin + "\n");
    assert.equal(knownHostsText("stale legacy pin", encoded), pin + "\n");
    assert.equal(
      transportConfigured({
        IMPORT_EVENTS_SSH_TARGET: "user@example.test",
        IMPORT_EVENTS_SSH_KEY_B64: "fixture",
        IMPORT_EVENTS_KNOWN_HOSTS_B64: encoded,
      }),
      true,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
