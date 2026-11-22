import { createPrismaClient } from '../../lib/prisma-client.mjs';
import assert from "node:assert/strict";
import { createDecipheriv, createHash } from "node:crypto";
import { once } from "node:events";
import http from "node:http";
import { spawn } from "node:child_process";
import test from "node:test";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required for integration tests");
const databaseName = new URL(databaseUrl).pathname.slice(1);
if (!/(?:test|integration)/i.test(databaseName)) {
  throw new Error(`Refusing to reset non-test database: ${databaseName}`);
}

const appPort = 3219;
const mockPort = 3220;
const appUrl = `http://127.0.0.1:${appPort}`;
const mockUrl = `http://127.0.0.1:${mockPort}`;
const authSecret = "integration-auth-secret-with-at-least-32-characters";
const db = createPrismaClient();
let app;
let mock;
let failPlaylists = false;
let malformedPlaylists = false;
let foreignNext = false;
let playlistGate = null;
let onPlaylistGate = null;

class Client {
  cookies = new Map();

  async request(path, options = {}) {
    const headers = new Headers(options.headers);
    const method = options.method ?? "GET";
    if (method !== "GET" && method !== "HEAD" && !headers.has("origin")) headers.set("origin", appUrl);
    if (this.cookies.size) headers.set("cookie", [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; "));
    if (options.body && !headers.has("content-type")) headers.set("content-type", "application/json");
    const response = await fetch(`${appUrl}${path}`, { ...options, headers, redirect: "manual" });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const separator = pair.indexOf("=");
      const key = pair.slice(0, separator);
      const value = pair.slice(separator + 1);
      if (value) this.cookies.set(key, value); else this.cookies.delete(key);
    }
    if (response.status === 308) {
      const location = new URL(response.headers.get("location"), appUrl);
      return this.request(`${location.pathname}${location.search}`, options);
    }
    return response;
  }

  json(path, method = "GET", body) {
    return this.request(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
  }
}

async function waitForApp() {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      const response = await fetch(appUrl);
      if (response.status < 500) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Next.js integration server did not start");
}

async function startApp(configured) {
  app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(appPort)], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      AUTH_SECRET: authSecret,
      APP_URL: appUrl,
      ...(configured ? {
        SPOTIFY_CLIENT_ID: "integration-client",
        SPOTIFY_CLIENT_SECRET: "integration-secret",
        SPOTIFY_ACCOUNTS_URL: mockUrl,
        SPOTIFY_API_URL: mockUrl,
      } : {
        SPOTIFY_CLIENT_ID: "",
        SPOTIFY_CLIENT_SECRET: "",
      }),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  app.stdout.on("data", (chunk) => { output = `${output}${chunk}`.slice(-8000); });
  app.stderr.on("data", (chunk) => { output = `${output}${chunk}`.slice(-8000); });
  app.on("exit", (code) => {
    if (code && code !== 143) process.stderr.write(`Next.js exited ${code}:\n${output}\n`);
  });
  await waitForApp();
}

async function stopApp() {
  if (!app || app.exitCode !== null) return;
  app.kill("SIGTERM");
  await once(app, "exit");
}

function decrypt(ciphertext) {
  const [iv, tag, body] = ciphertext.split(".").map((part) => Buffer.from(part, "base64url"));
  const key = createHash("sha256").update(authSecret).digest();
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(body), decipher.final()]).toString("utf8");
}

test.before(async () => {
  await db.notificationDelivery.deleteMany();
  await db.notificationEvent.deleteMany();
  await db.notificationSubscription.deleteMany();
  await db.notificationPreference.deleteMany();
  await db.spotifyConnection.deleteMany();
  await db.shareLink.deleteMany();
  await db.syncDocument.deleteMany();
  await db.session.deleteMany();
  await db.user.deleteMany();

  mock = http.createServer(async (request, response) => {
    response.setHeader("content-type", "application/json");
    if (request.url === "/api/token") {
      response.end(JSON.stringify({ access_token: "mock-access-token", refresh_token: "mock-refresh-token" }));
      return;
    }
    if (request.url === "/v1/me") {
      response.end(JSON.stringify({ id: "spotify-user-1" }));
      return;
    }
    if (request.url?.startsWith("/v1/me/playlists")) {
      if(playlistGate){const gate=playlistGate;playlistGate=null;onPlaylistGate?.();await gate;}
      if(malformedPlaylists){response.end(JSON.stringify({items:null,next:null}));return;}

      if (failPlaylists) {
        response.statusCode = 503;
        response.end(JSON.stringify({ error: "upstream unavailable" }));
        return;
      }
      const page2 = request.url.includes("offset=1");
      const item = (id) => ({ id, name: `Playlist ${id}`, external_urls: { spotify: `https://open.spotify.com/playlist/${id}` }, images: [], owner: { id: "owner", display_name: null }, tracks: { total: 3 } });
      response.end(JSON.stringify({ items: [item(page2 ? "two" : "one")], next: foreignNext ? "https://untrusted.example/v1/me/playlists" : page2 ? null : `${mockUrl}/v1/me/playlists?limit=50&offset=1` }));
      return;
    }
    response.statusCode = 404;
    response.end(JSON.stringify({ error: "not found" }));
  }).listen(mockPort, "127.0.0.1");
  await once(mock, "listening");
  await startApp(false);
});

test.after(async () => {
  await stopApp();
  await new Promise((resolve) => mock.close(resolve));
  await db.$disconnect();
});

test("auth, sync, sharing, and Spotify OAuth work against PostgreSQL", async () => {
  const anonymous = new Client();
  assert.equal((await anonymous.json("/api/auth/me")).status, 401);
  assert.equal((await anonymous.json("/api/sync/favorites")).status, 401);
  assert.equal((await anonymous.json("/api/share", "POST", { documentId: "x" })).status, 401);
  assert.equal((await anonymous.json("/api/spotify/sync", "POST")).status, 401);

  const passkeyClient = new Client();
  assert.equal((await passkeyClient.request("/api/auth/passkey/login/options", { method: "POST", headers: { origin: "https://foreign.example" } })).status, 403);
  const passkeyOptions = await passkeyClient.json("/api/auth/passkey/login/options", "POST", {});
  assert.equal(passkeyOptions.status, 200);
  assert.ok((await passkeyOptions.clone().json()).options.challenge);
  const ceremonyCookie = passkeyOptions.headers.getSetCookie().find((value) => value.startsWith("festival_radar_passkey_ceremony="));
  assert.match(ceremonyCookie, /HttpOnly/i);
  assert.match(ceremonyCookie, /SameSite=Strict/i);
  assert.match(ceremonyCookie, /Path=\/api\/auth\/passkey/i);
  assert.equal((await passkeyClient.json("/api/auth/passkey/login/verify", "POST", { id: "unknown" })).status, 401);

  assert.equal((await anonymous.json("/api/auth/register", "POST", { email: "bad", password: "short" })).status, 400);
  const registration = await anonymous.json("/api/auth/register", "POST", { email: "First@Example.com", password: "correct horse battery staple" });
  assert.equal(registration.status, 201);
  assert.equal((await registration.clone().json()).user.emailVerified, false);
  const sessionCookie = registration.headers.getSetCookie().find((value) => value.startsWith("festival_radar_session="));
  assert.match(sessionCookie, /HttpOnly/i);
  assert.match(sessionCookie, /SameSite=Lax/i);
  assert.match(sessionCookie, /Path=\//i);
  assert.match(sessionCookie, /Expires=/i);
  assert.equal((await new Client().json("/api/auth/register", "POST", { email: "first@example.com", password: "correct horse battery staple" })).status, 409);
  assert.equal((await new Client().json("/api/auth/passkey/register/options", "POST", { email: "first@example.com" })).status, 409);
  assert.equal((await anonymous.request("/api/auth/logout", { method: "POST", headers: { origin: "https://foreign.example" } })).status, 403);
  assert.equal((await anonymous.json("/api/auth/me")).status, 200);
  assert.equal((await anonymous.json("/api/auth/logout", "POST")).status, 204);
  assert.equal((await anonymous.json("/api/auth/me")).status, 401);
  assert.equal((await anonymous.json("/api/auth/login", "POST", { email: "first@example.com", password: "wrong" })).status, 401);
  assert.equal((await anonymous.json("/api/auth/login", "POST", { email: "first@example.com", password: "correct horse battery staple" })).status, 200);
  assert.equal((await (await anonymous.json("/api/auth/me")).json()).user.emailVerified, false);

  const firstUser = await db.user.findUniqueOrThrow({ where: { email: "first@example.com" } });
  await db.session.updateMany({ where: { userId: firstUser.id }, data: { expiresAt: new Date(0) } });
  assert.equal((await anonymous.json("/api/auth/me")).status, 401);
  assert.equal((await anonymous.json("/api/auth/login", "POST", { email: "first@example.com", password: "correct horse battery staple" })).status, 200);

  assert.equal((await anonymous.json("/api/sync/nope")).status, 404);
  assert.equal((await anonymous.json("/api/sync/favorites", "PUT", { payload: null, revision: 0 })).status, 400);
  const created = await anonymous.json("/api/sync/favorites", "PUT", { payload: { festivals: ["wacken"] }, revision: 0 });
  assert.equal(created.status, 201);
  const createdBody = await created.json();
  assert.equal(createdBody.document.revision, 1);
  assert.equal((await anonymous.request("/api/sync/favorites", { method: "PUT", headers: { origin: "https://foreign.example", "content-type": "application/json" }, body: JSON.stringify({ payload: { festivals: ["forged"] }, revision: 1 }) })).status, 403);
  assert.equal((await db.syncDocument.findUniqueOrThrow({ where: { id: createdBody.document.id } })).revision, 1);
  const updated = await anonymous.json("/api/sync/favorites", "PUT", { payload: { festivals: ["wacken", "graspop"] }, revision: 1 });
  assert.equal(updated.status, 200);
  assert.equal((await updated.json()).document.revision, 2);
  assert.equal((await anonymous.json("/api/sync/favorites", "PUT", { payload: { festivals: [] }, revision: 1 })).status, 409);

  const second = new Client();
  assert.equal((await second.json("/api/auth/register", "POST", { email: "second@example.com", password: "another secure password" })).status, 201);
  assert.equal((await (await second.json("/api/sync/favorites")).json()).document, null);
  assert.equal((await second.json("/api/share", "POST", { documentId: createdBody.document.id })).status, 404);

  const share = await anonymous.json("/api/share", "POST", { documentId: createdBody.document.id, expiresAt: new Date(Date.now() + 60_000).toISOString() });
  assert.equal(share.status, 201);
  const shareBody = await share.json();
  const publicShare = await new Client().json(`/api/share/${shareBody.share.slug}`);
  assert.equal(publicShare.status, 200);
  const publicBody = await publicShare.json();
  assert.deepEqual(Object.keys(publicBody).sort(), ["kind", "payload", "updatedAt"]);
  assert.equal(publicBody.userId, undefined);
  assert.equal((await new Client().json("/api/share/unknown-slug")).status, 404);
  await db.shareLink.update({ where: { slug: shareBody.share.slug }, data: { expiresAt: new Date(0) } });
  assert.equal((await new Client().json(`/api/share/${shareBody.share.slug}`)).status, 404);

  assert.equal((await anonymous.json("/api/spotify/connect")).status, 503);
  await stopApp();
  await startApp(true);

  const connect = await anonymous.json("/api/spotify/connect");
  assert.equal(connect.status, 302);
  const authorization = new URL(connect.headers.get("location"));
  const validState = authorization.searchParams.get("state");
  assert.ok(validState);
  assert.equal((await anonymous.json(`/api/spotify/callback?code=code&state=wrong`)).status, 400);

  const reconnect = await anonymous.json("/api/spotify/connect");
  const reconnectUrl = new URL(reconnect.headers.get("location"));
  const callback = await anonymous.json(`/api/spotify/callback?code=code&state=${encodeURIComponent(reconnectUrl.searchParams.get("state"))}`);
  assert.equal(callback.status, 302);
  const connection = await db.spotifyConnection.findUniqueOrThrow({ where: { userId: firstUser.id } });
  assert.notEqual(connection.encryptedRefreshToken, "mock-refresh-token");
  assert.equal(decrypt(connection.encryptedRefreshToken), "mock-refresh-token");

  // A legacy selection-only client remains supported. Import must not replace it.
  const selection=await anonymous.json("/api/sync/collections","PUT",{revision:0,payload:{playlistFestivals:["wacken"]}});
  assert.equal(selection.status,201);const selected=(await selection.json()).document;
  assert.equal((await anonymous.json("/api/spotify/sync","POST")).status,400);
  const sync=await anonymous.json("/api/spotify/sync","POST",{revision:selected.revision});
  assert.equal(sync.status,200);let document=(await sync.json()).document;
  assert.equal(document.payload.schemaVersion,1);assert.deepEqual(document.payload.playlistFestivals,["wacken"]);
  assert.deepEqual(document.payload.spotify.playlists.map(p=>p.id),["one","two"]);
  const imported=document.payload.spotify;
  const normal=await anonymous.json("/api/sync/collections","PUT",{revision:document.revision,payload:{playlistFestivals:["wacken","graspop"]}});
  assert.equal(normal.status,200);document=(await normal.json()).document;
  assert.deepEqual(document.payload.spotify,imported);
  assert.equal((await anonymous.json("/api/spotify/sync","POST",{revision:selected.revision})).status,409);
  const secondDevice=new Client();
  assert.equal((await secondDevice.json("/api/auth/login","POST",{email:"first@example.com",password:"correct horse battery staple"})).status,200);
  const readback=(await (await secondDevice.json("/api/sync/collections")).json()).document;
  assert.deepEqual(readback,document);
  const staleRevision=document.revision;
  const merged=await secondDevice.json("/api/sync/collections","PUT",{revision:document.revision,payload:{schemaVersion:1,playlistFestivals:["wacken","graspop","reading"],spotify:null}});
  assert.equal(merged.status,200);document=(await merged.json()).document;
  assert.deepEqual(document.payload.spotify,imported);
  assert.equal((await anonymous.json("/api/sync/collections","PUT",{revision:staleRevision,payload:{playlistFestivals:[]}})).status,409);
  // Provider errors, unexpected response shapes and foreign pagination preserve the last good import/time.
  const lastSuccessful=(await db.spotifyConnection.findUniqueOrThrow({where:{userId:firstUser.id}})).lastSyncedAt.toISOString();
  for(const failure of ["upstream","schema","pagination"]){
   failPlaylists=failure==="upstream";malformedPlaylists=failure==="schema";foreignNext=failure==="pagination";
   assert.equal((await anonymous.json("/api/spotify/sync","POST",{revision:document.revision})).status,502);
   assert.deepEqual((await (await anonymous.json("/api/sync/collections")).json()).document,document);
   assert.equal((await db.spotifyConnection.findUniqueOrThrow({where:{userId:firstUser.id}})).lastSyncedAt.toISOString(),lastSuccessful);
  }
  failPlaylists=malformedPlaylists=foreignNext=false;
  // Provider fetch starts from revision N; another device commits N+1 before import finishes.
  let release;playlistGate=new Promise(resolve=>{release=resolve;});
  let entered;const gated=new Promise(resolve=>{entered=resolve;});onPlaylistGate=entered;
  const racingImport=anonymous.json("/api/spotify/sync","POST",{revision:document.revision});
  try{
   let gateTimer;
   try { await Promise.race([gated,new Promise((_,reject)=>{gateTimer=setTimeout(()=>reject(new Error("Provider race fixture was not reached")),15000);})]); }
   finally { clearTimeout(gateTimer); }
   const concurrent=await secondDevice.json("/api/sync/collections","PUT",{revision:document.revision,payload:{playlistFestivals:["concurrent-selection"]}});
   assert.equal(concurrent.status,200);document=(await concurrent.json()).document;
  }finally{release();onPlaylistGate=null;}
  assert.equal((await racingImport).status,409);
  assert.deepEqual((await (await anonymous.json("/api/sync/collections")).json()).document,document);
  assert.equal((await db.spotifyConnection.findUniqueOrThrow({where:{userId:firstUser.id}})).lastSyncedAt.toISOString(),lastSuccessful);
  // Reconnecting a different provider identity while old pages are in flight cannot publish them.
  let releaseReconnect;playlistGate=new Promise(resolve=>{releaseReconnect=resolve;});
  let enteredReconnect;const reconnectGated=new Promise(resolve=>{enteredReconnect=resolve;});onPlaylistGate=enteredReconnect;
  const oldIdentityImport=anonymous.json("/api/spotify/sync","POST",{revision:document.revision});
  try {
   let gateTimer;
   try {await Promise.race([reconnectGated,new Promise((_,reject)=>{gateTimer=setTimeout(()=>reject(new Error("Reconnect fixture was not reached")),15000);})]);}
   finally {clearTimeout(gateTimer);}
   await db.spotifyConnection.update({where:{userId:firstUser.id},data:{spotifyUserId:"synthetic-other-provider"}});
  }finally{releaseReconnect();onPlaylistGate=null;}
  assert.equal((await oldIdentityImport).status,409);
  assert.deepEqual((await (await anonymous.json("/api/sync/collections")).json()).document,document);
  assert.equal((await db.spotifyConnection.findUniqueOrThrow({where:{userId:firstUser.id}})).lastSyncedAt.toISOString(),lastSuccessful);
  await db.spotifyConnection.update({where:{userId:firstUser.id},data:{spotifyUserId:connection.spotifyUserId}});
  // Legacy provider-only records survive the next ordinary selection write.
  await db.syncDocument.update({where:{id:document.id},data:{payload:{source:"spotify",...imported},revision:{increment:1}}});
  const legacy=(await (await anonymous.json("/api/sync/collections")).json()).document;
  const migrated=await anonymous.json("/api/sync/collections","PUT",{revision:legacy.revision,payload:{playlistFestivals:["reading"]}});
  assert.equal(migrated.status,200);document=(await migrated.json()).document;
  assert.equal(document.payload.schemaVersion,1);assert.deepEqual(document.payload.spotify,imported);
  assert.deepEqual(document.payload.playlistFestivals,["reading"]);
  // Concurrent first writes must produce a conflict, not an uncaught unique violation.
  const creates=await Promise.all([second.json("/api/sync/collections","PUT",{revision:0,payload:{playlistFestivals:["a"]}}),second.json("/api/sync/collections","PUT",{revision:0,payload:{playlistFestivals:["b"]}})]);
  assert.deepEqual(creates.map(r=>r.status).sort(),[201,409]);
});
