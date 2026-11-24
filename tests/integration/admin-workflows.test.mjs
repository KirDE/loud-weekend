import { readCatalog } from "../../lib/catalog/repository.ts";
import { requireLocalDisposableDatabase } from "../support/disposable-db.ts";
import { createPrismaClient } from "../../lib/prisma-client.mjs";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createServer } from "node:http";
import test from "node:test";

const databaseUrl = process.env.DATABASE_URL;
requireLocalDisposableDatabase(databaseUrl);
const db = createPrismaClient();
const port = 3244;
const origin = `http://127.0.0.1:${port}`;
let app;
const sourceOrigin = "http://127.0.0.1:3250";
const requests = [];
const ticketsUrl = "https://tickets.example.test/integration";
let primaryFails = false;
let primaryOffersWithoutEdition = false;
let primaryHasDatedFallback = false;
let observedTicketsUrl = ticketsUrl;
let includePerformer = false;
let includeAnotherEvent = false;
let primaryStartDate;
let observedCity = "Wacken Preview";
const performer = "Example Metal Band";
const replacementTicketsUrl = "https://tickets.example.test/replacement";
let originalStartDate = "2027-07-28";
let datesChanged = false;
const correctedStartDate = "2027-07-29";
const sourceServer = createServer((request, response) => {
  requests.push(request.url);
  if (request.url === "/failing" || primaryFails) {
    response.writeHead(503, { "retry-after": "0" });
    response.end("unavailable");
    return;
  }
  assert.ok(request.url === "/primary" || request.url === "/dates");
  const startDate =
    request.url === "/primary"
      ? (primaryStartDate ?? originalStartDate)
      : datesChanged
        ? correctedStartDate
        : originalStartDate;
  const event = {
    "@context": "https://schema.org",
    "@type": "MusicEvent",
    name: "Wacken Open Air",
    startDate,
    ...(includePerformer && { performer: [{ "@type": "MusicGroup", name: performer }] }),
    endDate: "2027-07-31",
    location: { "@type": "Place", address: { addressLocality: observedCity } },
    offers: {
      "@type": "Offer",
      url: observedTicketsUrl,
      ...(request.url === "/primary" && { availability: "https://schema.org/SoldOut" }),
    },
  };
  if (request.url === "/primary" && primaryOffersWithoutEdition) {
    delete event.startDate;
    delete event.endDate;
    event.offers.availability = "https://schema.org/InStock";
  }
  response.setHeader("content-type", "text/html");
  const fallback =
    request.url === "/primary" && primaryOffersWithoutEdition && primaryHasDatedFallback
      ? `<meta property="event:start_time" content="${startDate}">`
      : "";
  const otherEvent =
    request.url === "/primary" && includeAnotherEvent
      ? `<script type="application/ld+json">${JSON.stringify({
          "@type": "MusicEvent",
          name: "Another event",
          startDate: "2027-08-01",
        })}</script>`
      : "";
  response.end(
    `${fallback}<script type="application/ld+json">${JSON.stringify(event)}</script>${otherEvent}`,
  );
});

class Client {
  cookies = new Map();
  async json(path, method = "GET", body, initialHeaders) {
    const headers = new Headers(initialHeaders);
    if (method !== "GET" && method !== "HEAD" && !headers.has("origin"))
      headers.set("origin", origin);
    if (body !== undefined) headers.set("content-type", "application/json");
    if (this.cookies.size)
      headers.set("cookie", [...this.cookies].map(([key, value]) => `${key}=${value}`).join("; "));
    const response = await fetch(`${origin}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "manual",
    });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(";");
      const at = pair.indexOf("=");
      if (at > 0) this.cookies.set(pair.slice(0, at), pair.slice(at + 1));
    }
    if (response.status === 308) {
      const redirect = new URL(response.headers.get("location"), origin);
      return this.json(redirect.pathname + redirect.search, method, body, headers);
    }
    return response;
  }
}

test.before(async () => {
  await db.$executeRawUnsafe(
    'TRUNCATE TABLE "AdminChange", "AdminDraft", "AdminParserRun"' +
      ', "AdminResourceState", "AdminAuditEntry", "Session", "User"' +
      " CASCADE",
  );
  const festival = await db.festival.upsert({
    where: { slug: "wacken-open-air" },
    create: {
      slug: "wacken-open-air",
      name: "Wacken Open Air",
      country: "Germany",
      countryCode: "DE",
      city: "Wacken",
      officialUrl: "https://www.wacken.com/",
      genres: ["metal"],
    },
    update: { city: "Wacken" },
  });
  const edition = await db.festivalEdition.upsert({
    where: { festivalId_year: { festivalId: festival.id, year: 2027 } },
    create: {
      festivalId: festival.id,
      year: 2027,
      startDate: new Date("2027-07-28T00:00:00Z"),
      endDate: new Date("2027-07-31T00:00:00Z"),
      status: "CONFIRMED",
      ticketStatus: "UNKNOWN",
      ticketsUrl,
      recordState: "CURRENT",
      completeness: "PARTIAL",
      sourceUpdatedAt: new Date(),
    },
    update: {
      recordState: "CURRENT",
      startDate: new Date("2027-07-28T00:00:00Z"),
      endDate: new Date("2027-07-31T00:00:00Z"),
      status: "CONFIRMED",
      ticketStatus: "UNKNOWN",
      ticketsUrl,
    },
  });
  await db.lineupEntry.deleteMany({ where: { editionId: edition.id } });
  const archive = await db.festivalEdition.upsert({
    where: { festivalId_year: { festivalId: festival.id, year: 2026 } },
    create: {
      festivalId: festival.id,
      year: 2026,
      status: "CONFIRMED",
      ticketStatus: "UNKNOWN",
      recordState: "ARCHIVED",
      completeness: "PARTIAL",
      sourceUpdatedAt: new Date(),
    },
    update: { recordState: "ARCHIVED" },
  });
  await db.festivalSource.deleteMany({ where: { festivalSlug: festival.slug } });
  await db.artist.updateMany({
    where: { slug: "integration-headliner" },
    data: { name: "Integration Headliner", aliases: [], biography: null },
  });
  await db.artistLink.deleteMany({ where: { artist: { slug: "integration-headliner" } } });
  await db.artistProvenance.deleteMany({ where: { artist: { slug: "integration-headliner" } } });
  const configured = {
    festivalSlug: festival.slug,
    festivalId: festival.id,
    editionId: edition.id,
    editionYear: 2027,
    strategies: ["json_ld_event", "html_fallback"],
    refreshPolicy: "daily",
    enabled: true,
    parserKey: "json_ld_event+html_fallback",
    cadenceSeconds: 86400,
    configurationBackfilledAt: new Date(),
  };
  await db.festivalSource.createMany({
    data: [
      { ...configured, url: sourceOrigin + "/primary" },
      { ...configured, url: sourceOrigin + "/dates" },
      { ...configured, url: sourceOrigin + "/failing" },
      { ...configured, url: sourceOrigin + "/disabled", enabled: false },
      { ...configured, url: sourceOrigin + "/archived", editionId: archive.id, editionYear: 2026 },
    ],
  });
  sourceServer.listen(3250, "127.0.0.1");
  await once(sourceServer, "listening");
  app = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "-p", String(port)], {
    env: {
      ...process.env,
      DATABASE_URL: databaseUrl,
      AUTH_SECRET: "admin-integration-secret-at-least-32",
      APP_URL: origin,
      SUBMISSION_HASH_SALT: "integration-submission-salt",
      ADMIN_EMAILS: "viewer@example.test,editor@example.test,admin@example.test",
    },
    stdio: ["ignore", "ignore", "inherit"],
  });
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      if ((await fetch(origin)).status < 500) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("Integration server did not start");
});
test.after(async () => {
  if (app?.exitCode === null) {
    app.kill("SIGTERM");
    await once(app, "exit");
  }
  sourceServer.close();
  await once(sourceServer, "close");
  await db.$disconnect();
});

test("persisted admin drafts, decisions, conflicts, authorization and audit invariants", async () => {
  const anonymous = new Client();
  assert.equal((await anonymous.json("/api/admin")).status, 403);
  assert.equal((await anonymous.json("/api/admin", "POST", {})).status, 403);
  assert.equal(
    (await anonymous.json("/api/admin/changes/missing", "POST", { decision: "approve" })).status,
    403,
  );
  assert.equal(
    (await anonymous.json("/api/admin/drafts/missing", "PATCH", { values: { city: "x" } })).status,
    403,
  );
  assert.equal((await anonymous.json("/api/admin/drafts/missing", "DELETE")).status, 403);
  assert.equal((await anonymous.json("/api/admin/refresh/wacken-open-air", "POST")).status, 403);
  assert.equal(
    (
      await anonymous.json("/api/submissions", "POST", {
        name: "  New   Metal Fest ",
        year: 2028,
        officialUrl: "https://WWW.Example.test/festival#tickets",
        notes: "Official source",
        website: "",
      })
    ).status,
    201,
  );
  const persistedSubmission = await db.festivalSubmission.findFirstOrThrow({
    include: { audit: true },
  });
  assert.equal(persistedSubmission.name, "New Metal Fest");
  assert.equal(persistedSubmission.officialUrl, "https://www.example.test/festival");
  assert.equal(persistedSubmission.notes, "Official source");
  assert.ok(persistedSubmission.publicReference.length >= 20);
  assert.equal(persistedSubmission.audit[0].action, "SUBMITTED");
  const duplicate = await anonymous.json("/api/submissions", "POST", {
    name: "new metal fest",
    year: 2028,
    officialUrl: "https://example.test/other",
    notes: "duplicate",
    website: "",
  });
  assert.equal(duplicate.status, 200);
  assert.equal((await duplicate.json()).reference, persistedSubmission.publicReference);
  assert.equal(await db.festivalSubmission.count(), 1);
  assert.equal(
    (
      await anonymous.json("/api/submissions", "POST", {
        name: "Bot",
        year: 2028,
        officialUrl: "https://bot.test",
        website: "filled",
      })
    ).status,
    400,
  );
  const nonAdmin = new Client();
  assert.equal(
    (
      await nonAdmin.json("/api/auth/register", "POST", {
        email: "viewer@example.test",
        password: "correct horse battery staple",
      })
    ).status,
    201,
  );
  assert.equal((await nonAdmin.json("/api/admin")).status, 403);
  assert.equal(
    (
      await nonAdmin.json("/api/admin", "POST", {
        resourceKind: "festival",
        resourceKey: "denied",
        baseRevision: 0,
        values: { city: "denied" },
      })
    ).status,
    403,
  );
  assert.equal((await nonAdmin.json("/api/admin/refresh/wacken-open-air", "POST")).status, 403);
  assert.equal((await nonAdmin.json("/api/admin/parser-runs/missing/log")).status, 403);
  assert.equal((await anonymous.json("/api/admin/parser-runs/missing/log")).status, 403);

  const editor = new Client();
  assert.equal(
    (
      await editor.json("/api/auth/register", "POST", {
        email: "editor@example.test",
        password: "correct horse battery staple",
      })
    ).status,
    201,
  );
  await db.user.update({ where: { email: "editor@example.test" }, data: { role: "EDITOR" } });
  assert.equal((await editor.json("/api/admin")).status, 200);
  assert.equal(
    (
      await editor.json("/api/admin", "POST", {
        resourceKind: "link",
        resourceKey: "editor-draft",
        baseRevision: 0,
        values: { officialUrl: "https://editor.example.test" },
      })
    ).status,
    201,
  );
  assert.equal((await editor.json("/api/admin/refresh/wacken-open-air", "POST")).status, 403);
  const admin = new Client();
  assert.equal(
    (
      await admin.json("/api/auth/register", "POST", {
        email: "admin@example.test",
        password: "correct horse battery staple",
      })
    ).status,
    201,
  );
  await db.user.update({ where: { email: "admin@example.test" }, data: { role: "ADMIN" } });
  const beforeForgedDrafts = await db.adminDraft.count();
  const beforeForgedAudit = await db.adminAuditEntry.count();
  assert.equal(
    (
      await admin.json(
        "/api/admin",
        "POST",
        {
          resourceKind: "festival",
          resourceKey: "forged",
          baseRevision: 0,
          values: { city: "forged" },
        },
        { origin: "https://foreign.example" },
      )
    ).status,
    403,
  );
  assert.equal(await db.adminDraft.count(), beforeForgedDrafts);
  assert.equal(await db.adminAuditEntry.count(), beforeForgedAudit);
  const draftResponse = await admin.json("/api/admin", "POST", {
    resourceKind: "festival",
    resourceKey: "wacken-open-air",
    baseRevision: 0,
    values: { city: "Wacken Preview", status: "confirmed" },
  });
  assert.equal(draftResponse.status, 201);
  const draft = await draftResponse.json();
  assert.equal(
    (
      await admin.json(`/api/admin/drafts/${draft.id}`, "PATCH", {
        values: { city: "Wacken Preview", status: "confirmed", country: "Germany" },
      })
    ).status,
    200,
  );
  assert.equal(await db.adminChange.count({ where: { draftId: draft.id } }), 3);
  const city = await db.adminChange.findFirstOrThrow({
    where: { draftId: draft.id, field: "city" },
  });
  const cityApproval = await admin.json(`/api/admin/changes/${city.id}`, "POST", {
    decision: "approve",
  });
  assert.equal(cityApproval.status, 200, await cityApproval.text());
  assert.deepEqual(
    (
      await db.adminResourceState.findUniqueOrThrow({
        where: {
          resourceKind_resourceKey: { resourceKind: "FESTIVAL", resourceKey: "wacken-open-air" },
        },
      })
    ).values,
    { city: "Wacken Preview" },
  );
  assert.equal(
    (
      await admin.json("/api/admin", "POST", {
        resourceKind: "festival",
        resourceKey: "wacken-open-air",
        baseRevision: 0,
        values: { city: "stale" },
      })
    ).status,
    409,
  );
  const status = await db.adminChange.findFirstOrThrow({
    where: { draftId: draft.id, field: "status" },
  });
  assert.equal(
    (await admin.json(`/api/admin/changes/${status.id}`, "POST", { decision: "reject" })).status,
    200,
  );
  assert.equal(
    (
      await db.adminResourceState.findUniqueOrThrow({
        where: {
          resourceKind_resourceKey: { resourceKind: "FESTIVAL", resourceKey: "wacken-open-air" },
        },
      })
    ).values.city,
    "Wacken Preview",
  );
  assert.equal(
    (await db.festival.findUniqueOrThrow({ where: { slug: "wacken-open-air" } })).city,
    "Wacken Preview",
  );
  assert.ok(await db.catalogPublication.findUnique({ where: { sourceId: `admin:${city.id}` } }));

  const lineupDraftResponse = await admin.json("/api/admin", "POST", {
    resourceKind: "festival",
    resourceKey: "wacken-open-air",
    baseRevision: 1,
    values: { headliners: "Integration Headliner" },
  });
  assert.equal(lineupDraftResponse.status, 201);
  const lineupDraft = await lineupDraftResponse.json();
  const lineupChange = await db.adminChange.findFirstOrThrow({
    where: { draftId: lineupDraft.id, field: "headliners" },
  });
  assert.equal(
    (await admin.json(`/api/admin/changes/${lineupChange.id}`, "POST", { decision: "approve" }))
      .status,
    200,
  );
  const lineupPublication = await db.catalogPublication.findUniqueOrThrow({
    where: { sourceId: `admin:${lineupChange.id}` },
  });
  assert.equal(lineupPublication.lineupChanged, true);
  assert.equal(
    (
      await db.catalogPlaylistRefresh.findUniqueOrThrow({
        where: { publicationId: lineupPublication.id },
      })
    ).status,
    "PENDING",
  );
  const publishedHeadliners = await db.lineupEntry.findMany({
    where: {
      edition: { festival: { slug: "wacken-open-air" }, recordState: "CURRENT" },
      billing: "HEADLINER",
    },
    include: { artist: true },
  });
  assert.deepEqual(
    publishedHeadliners.map(({ artist }) => artist.name),
    ["Integration Headliner"],
  );

  const artistSlug = "integration-headliner";
  const originalArtist = await db.artist.findUniqueOrThrow({ where: { slug: artistSlug } });
  const editionId = publishedHeadliners[0].editionId;
  for (const [start, artistId] of [
    ["12:00", originalArtist.id],
    ["18:00", null],
  ]) {
    const slot = {
      editionId,
      date: new Date("2027-07-28T00:00:00Z"),
      stage: "Integration Stage",
      start,
      artistName: originalArtist.name,
    };
    await db.timetablePerformance.upsert({
      where: { editionId_date_stage_start_artistName: slot },
      create: { ...slot, artistId },
      update: { artistId },
    });
  }
  const artistName = "Integration Headliner Revised";
  const officialSite = "https://artist.example.test/";
  const artistResponse = await admin.json("/api/admin", "POST", {
    resourceKind: "artist",
    resourceKey: artistSlug,
    baseRevision: 0,
    values: { canonicalName: artistName, officialUrl: officialSite },
  });
  assert.equal(artistResponse.status, 201);
  const artistDraft = await artistResponse.json();
  const artistChanges = await db.adminChange.findMany({
    where: { draftId: artistDraft.id },
    orderBy: { field: "asc" },
  });
  assert.deepEqual(
    artistChanges.map(({ beforeValue }) => beforeValue),
    ["Integration Headliner", null],
  );
  const decideArtist = (id, decision = "approve") =>
    admin.json(`/api/admin/changes/${id}`, "POST", { decision });

  // A concurrent canonical edit outside the admin revision counters must not be overwritten.
  await db.artist.update({
    where: { id: originalArtist.id },
    data: { name: "Integration Independent Edit" },
  });
  assert.equal((await decideArtist(artistChanges[0].id)).status, 409);
  assert.equal(
    (await db.artist.findUniqueOrThrow({ where: { slug: artistSlug } })).name,
    "Integration Independent Edit",
  );
  await db.artist.update({ where: { id: originalArtist.id }, data: { name: originalArtist.name } });

  for (const change of artistChanges) {
    const response = await decideArtist(change.id);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).artistPublication, "published");
  }
  const canonicalArtist = await db.artist.findUniqueOrThrow({
    where: { slug: artistSlug },
    include: { links: true, provenance: true },
  });
  assert.equal(canonicalArtist.id, originalArtist.id);
  assert.equal(canonicalArtist.name, artistName);
  assert.ok(canonicalArtist.aliases.includes(originalArtist.name));
  assert.equal(canonicalArtist.links[0].url, officialSite);
  assert.equal(canonicalArtist.provenance[0].url, officialSite);
  const publishedCatalog = await readCatalog({ database: db });
  const scheduled = publishedCatalog.festivals
    .find(({ slug }) => slug === "wacken-open-air")
    .timetable.filter(({ stage }) => stage === "Integration Stage");
  assert.deepEqual(
    scheduled.map(({ artist }) => artist),
    [artistName, artistName],
  );
  assert.equal(
    await db.timetablePerformance.count({
      where: { editionId, artistName: originalArtist.name, stage: "Integration Stage" },
    }),
    2,
  );

  const publicArtist = await anonymous.json(`/artists/${artistSlug}/`);
  assert.equal(publicArtist.status, 200);
  const artistHtml = await publicArtist.text();
  assert.match(artistHtml, /Integration Headliner Revised/);
  assert.match(artistHtml, /https:\/\/artist\.example\.test\//);

  const noopResponse = await admin.json("/api/admin", "POST", {
    resourceKind: "artist",
    resourceKey: artistSlug,
    baseRevision: 2,
    values: { officialUrl: officialSite },
  });
  assert.equal(noopResponse.status, 201);
  const noopDraft = await noopResponse.json();
  const noop = await db.adminChange.findFirstOrThrow({ where: { draftId: noopDraft.id } });
  assert.equal((await (await decideArtist(noop.id)).json()).artistPublication, "unchanged");
  assert.equal(await db.artistProvenance.count({ where: { artistId: originalArtist.id } }), 1);
  const socialUrl = "https://www.instagram.com/synthetic-artist/";
  const evidenceUrl = "https://artist.example.test/official-links/";
  const observedAt = "2026-01-01T00:00:00Z";
  const candidate = await db.artistLink.create({
    data: {
      artistId: originalArtist.id,
      url: socialUrl,
      label: "Social profile",
      source: "musicbrainz",
      position: 1,
    },
  });
  const saveSocial = (proof, baseRevision = 3) =>
    admin.json("/api/admin", "POST", {
      resourceKind: "artist",
      resourceKey: artistSlug,
      baseRevision,
      values: { socialProfile: proof },
    });
  const proof = { url: socialUrl, sourceUrl: evidenceUrl, observedAt };
  assert.equal(
    (await saveSocial({ ...proof, sourceUrl: "https://other.example.test/" })).status,
    409,
  );
  assert.equal(
    (await saveSocial({ ...proof, sourceUrl: evidenceUrl + "?secret=test" })).status,
    409,
  );
  assert.equal((await saveSocial({ ...proof, url: socialUrl + "wrong-identity" })).status, 409);
  const socialResponse = await saveSocial(proof);
  assert.equal(socialResponse.status, 201, await socialResponse.clone().text());
  const savedSocial = await socialResponse.json();
  const socialChange = await db.adminChange.findFirstOrThrow({
    where: { draftId: savedSocial.id },
  });
  const getCandidate = () => db.artistLink.findUniqueOrThrow({ where: { id: candidate.id } });
  assert.equal((await getCandidate()).verified, false);
  const officialLinkId = canonicalArtist.links[0].id;
  await db.artistLink.update({
    where: { id: officialLinkId },
    data: { url: "https://artist.example.test/new/" },
  });
  assert.equal((await decideArtist(socialChange.id)).status, 409);
  assert.equal((await getCandidate()).verified, false);
  await db.artistLink.update({ where: { id: officialLinkId }, data: { url: officialSite } });
  const approvedSocial = await decideArtist(socialChange.id);
  assert.equal(approvedSocial.status, 200);
  assert.equal((await approvedSocial.json()).artistPublication, "published");
  assert.equal((await getCandidate()).verified, true);
  const socialProof = await db.artistProvenance.findFirstOrThrow({
    where: {
      artistId: originalArtist.id,
      field: "links",
      source: "official",
      url: evidenceUrl,
    },
  });
  assert.equal(socialProof.checkedAt.toISOString(), "2026-01-01T00:00:00.000Z");
  assert.ok(
    await db.adminAuditEntry.findFirst({
      where: {
        action: "CHANGE_APPROVED",
        resourceKey: artistSlug,
        afterValue: { path: ["sourceUrl"], equals: evidenceUrl },
      },
    }),
  );
  const publishedArtist = await anonymous.json(`/artists/${artistSlug}/`);
  assert.match(
    await publishedArtist.text(),
    /href="https:\/\/www\.instagram\.com\/synthetic-artist\/"/,
  );

  const biography = {
    text: "The integration fixture blends two guitar styles.",
    sourceUrl: "https://artist.example.test/biography/",
    observedAt: "2026-01-02T00:00:00Z",
  };
  const saveBiography = (client, proof, baseRevision = 4) =>
    client.json("/api/admin", "POST", {
      resourceKind: "artist",
      resourceKey: artistSlug,
      baseRevision,
      values: { biography: proof },
    });
  const getArtist = () => db.artist.findUniqueOrThrow({ where: { id: originalArtist.id } });
  assert.equal((await saveBiography(anonymous, biography)).status, 403);
  assert.equal(
    (await saveBiography(admin, { ...biography, sourceUrl: "https://unrelated.example.test/" }))
      .status,
    409,
  );
  assert.equal(
    (await saveBiography(admin, { ...biography, observedAt: "2099-01-01T00:00:00Z" })).status,
    409,
  );
  const queuedBiography = await saveBiography(admin, biography);
  assert.equal(queuedBiography.status, 201, await queuedBiography.clone().text());
  const biographyDraft = await queuedBiography.json();
  const biographyChange = await db.adminChange.findFirstOrThrow({
    where: { draftId: biographyDraft.id },
  });
  assert.equal((await getArtist()).biography, null);
  assert.doesNotMatch(
    await (await anonymous.json(`/artists/${artistSlug}/`)).text(),
    /blends two guitar styles/,
  );
  await db.artist.update({
    where: { id: originalArtist.id },
    data: { biography: "Previously reviewed biography" },
  });
  assert.equal((await decideArtist(biographyChange.id)).status, 409);
  assert.equal((await getArtist()).biography, "Previously reviewed biography");
  await db.artist.update({ where: { id: originalArtist.id }, data: { biography: null } });
  const approvedBiography = await decideArtist(biographyChange.id);
  assert.equal(approvedBiography.status, 200, await approvedBiography.clone().text());
  assert.equal((await approvedBiography.json()).artistPublication, "published");
  assert.equal((await getArtist()).biography, biography.text);
  const publicBiography = await (await anonymous.json(`/artists/${artistSlug}/`)).text();
  assert.match(publicBiography, /blends two guitar styles/);
  assert.match(publicBiography, /href="https:\/\/artist\.example\.test\/biography\/"/);
  assert.equal(
    (await saveBiography(admin, { ...biography, text: "Stale edit", observedAt }, 5)).status,
    409,
  );
  const noopBiography = await saveBiography(admin, biography, 5);
  assert.equal(noopBiography.status, 201, await noopBiography.clone().text());
  const noopBiographyDraft = await noopBiography.json();
  const noopBiographyChange = await db.adminChange.findFirstOrThrow({
    where: { draftId: noopBiographyDraft.id },
  });
  assert.equal(
    (await (await decideArtist(noopBiographyChange.id)).json()).artistPublication,
    "unchanged",
  );
  assert.equal(
    await db.artistProvenance.count({ where: { artistId: originalArtist.id, field: "biography" } }),
    1,
  );

  const rejectedResponse = await admin.json("/api/admin", "POST", {
    resourceKind: "artist",
    resourceKey: artistSlug,
    baseRevision: 6,
    values: { canonicalName: "Unpublished Name" },
  });
  assert.equal(rejectedResponse.status, 201);
  const rejectedDraft = await rejectedResponse.json();
  const rejected = await db.adminChange.findFirstOrThrow({ where: { draftId: rejectedDraft.id } });
  assert.equal((await decideArtist(rejected.id, "reject")).status, 200);
  assert.equal(
    (await db.artist.findUniqueOrThrow({ where: { slug: artistSlug } })).name,
    artistName,
  );

  // A rejection does not change the live revision and must not prevent a
  // corrected proposal from using that same base. Keep the old audit record.
  const submitArtistCorrection = (canonicalName) =>
    admin.json("/api/admin", "POST", {
      resourceKind: "artist",
      resourceKey: artistSlug,
      baseRevision: 6,
      values: { canonicalName },
    });
  const correctionResponse = await submitArtistCorrection("Integration Reviewer Correction");
  assert.equal(correctionResponse.status, 201);
  const correction = await correctionResponse.json();
  assert.ok(correction.revision > rejectedDraft.revision);
  assert.equal(correction.baseRevision, rejectedDraft.baseRevision);
  const competingResponse = await submitArtistCorrection("Integration Competing Correction");
  assert.equal(competingResponse.status, 201);
  const competing = await competingResponse.json();
  assert.ok(competing.revision > correction.revision);

  const correctedName = await db.adminChange.findFirstOrThrow({
    where: { draftId: correction.id },
  });
  const competingName = await db.adminChange.findFirstOrThrow({ where: { draftId: competing.id } });
  assert.equal((await decideArtist(correctedName.id)).status, 200);
  assert.equal((await decideArtist(competingName.id)).status, 409);
  assert.equal(
    (await db.adminDraft.findUniqueOrThrow({ where: { id: rejectedDraft.id } })).status,
    "REJECTED",
  );
  assert.equal(
    (await db.artist.findUniqueOrThrow({ where: { slug: artistSlug } })).name,
    "Integration Reviewer Correction",
  );

  const logoBytes = await sharp({
    create: { width: 2, height: 2, channels: 3, background: "#c05040" },
  })
    .png()
    .toBuffer();
  const logoHash = createHash("sha256").update(logoBytes).digest("hex");
  await db.assetBlob.upsert({
    where: { sha256: logoHash },
    create: {
      sha256: logoHash,
      mimeType: "image/png",
      sizeBytes: logoBytes.length,
      bytes: logoBytes,
    },
    update: {},
  });
  const festivalRecord = await db.festival.findUniqueOrThrow({
    where: { slug: "wacken-open-air" },
  });
  await db.festivalLogo.deleteMany({ where: { festivalId: festivalRecord.id } });
  const logoPath = "/api/logos/wacken-open-air.png/";
  assert.equal((await anonymous.json(logoPath)).status, 404);
  const invalidLogo = await admin.json("/api/admin", "POST", {
    resourceKind: "asset",
    resourceKey: "wacken-open-air",
    baseRevision: 0,
    values: { logoUrl: officialSite },
  });
  assert.equal(invalidLogo.status, 409);
  const logoResponse = await admin.json("/api/admin", "POST", {
    resourceKind: "asset",
    resourceKey: "wacken-open-air",
    baseRevision: 0,
    values: { logoAssetHash: logoHash },
  });
  assert.equal(logoResponse.status, 201);
  const logoDraft = await logoResponse.json();
  const logoChange = await db.adminChange.findFirstOrThrow({ where: { draftId: logoDraft.id } });
  assert.equal((await anonymous.json(logoPath)).status, 404);
  const approvedLogo = await decideArtist(logoChange.id);
  assert.equal(approvedLogo.status, 200);
  assert.equal((await approvedLogo.json()).logoPublication, "published");
  const servedLogo = await anonymous.json(logoPath);
  assert.equal(servedLogo.status, 200);
  assert.equal(servedLogo.headers.get("etag"), `"${logoHash}"`);
  assert.deepEqual(Buffer.from(await servedLogo.arrayBuffer()), logoBytes);

  const queueLogo = async (baseRevision) => {
    const response = await admin.json("/api/admin", "POST", {
      resourceKind: "asset",
      resourceKey: "wacken-open-air",
      baseRevision,
      values: { logoAssetHash: logoHash },
    });
    assert.equal(response.status, 201);
    const { id } = await response.json();
    return db.adminChange.findFirstOrThrow({ where: { draftId: id } });
  };
  const noOpLogo = await queueLogo(1);
  assert.equal((await (await decideArtist(noOpLogo.id)).json()).logoPublication, "unchanged");
  const staleLogo = await queueLogo(2);
  await db.festivalLogo.delete({ where: { festivalId: festivalRecord.id } });
  assert.equal((await decideArtist(staleLogo.id)).status, 409);
  assert.equal((await anonymous.json(logoPath)).status, 404);
  assert.equal(
    (await db.adminChange.findUniqueOrThrow({ where: { id: staleLogo.id } })).status,
    "PENDING",
  );

  assert.equal((await decideArtist(staleLogo.id, "reject")).status, 200);
  assert.equal((await anonymous.json(logoPath)).status, 404);

  const playlistEdition = await db.festivalEdition.findFirstOrThrow({
    where: { festivalId: festivalRecord.id, recordState: "CURRENT" },
  });
  const playlistKey = `wacken-open-air:${playlistEdition.year}:spotify`;
  const bindingKey = { editionId: playlistEdition.id, provider: "spotify" };
  const managedUrl = "https://open.spotify.com/playlist/Managed000000000000001";
  const reviewedUrl = "https://open.spotify.com/playlist/Reviewed00000000000001";
  const otherUrl = "https://open.spotify.com/playlist/Reviewed00000000000002";
  await db.festivalPlaylist.upsert({
    where: { editionId_provider: bindingKey },
    create: { ...bindingKey, url: managedUrl, artistCount: 3, trackCount: 7 },
    update: { url: managedUrl, artistCount: 3, trackCount: 7 },
  });
  await db.festivalPlaylistLink.deleteMany({ where: bindingKey });
  const pendingProviderJobs = await db.catalogPlaylistRefresh.count();

  async function savePlaylist(key, revision, url) {
    return admin.json("/api/admin", "POST", {
      resourceKind: "playlist",
      resourceKey: key,
      baseRevision: revision,
      values: { url },
    });
  }

  async function queuePlaylist(revision, url) {
    const response = await savePlaylist(playlistKey, revision, url);
    assert.equal(response.status, 201);
    const { id } = await response.json();
    return db.adminChange.findFirstOrThrow({ where: { draftId: id } });
  }

  async function festivalPage() {
    const response = await anonymous.json("/festivals/wacken-open-air/");
    assert.equal(response.status, 200);
    return response.text();
  }

  assert.equal((await savePlaylist("integration-playlist", 0, reviewedUrl)).status, 409);
  assert.equal((await savePlaylist("wacken-open-air:2025:spotify", 0, reviewedUrl)).status, 409);
  assert.equal((await savePlaylist(playlistKey, 0, "https://example.test/playlist")).status, 409);
  const playlistChange = await queuePlaylist(0, otherUrl);
  const updatedDraft = await admin.json(`/api/admin/drafts/${playlistChange.draftId}`, "PATCH", {
    values: { url: reviewedUrl },
  });
  assert.equal(updatedDraft.status, 200);
  const updatedChange = await db.adminChange.findFirstOrThrow({
    where: { draftId: playlistChange.draftId },
  });
  assert.deepEqual(updatedChange.sourceEvidence, {
    kind: "playlist-draft",
    editionId: playlistEdition.id,
    draftId: playlistChange.draftId,
  });
  assert.ok(!(await festivalPage()).includes(reviewedUrl));
  const playlistApproval = await decideArtist(updatedChange.id);
  assert.equal(playlistApproval.status, 200);
  assert.equal((await playlistApproval.json()).playlistPublication, "published");
  assert.ok((await festivalPage()).includes(reviewedUrl));
  assert.equal(
    (await db.festivalPlaylist.findUniqueOrThrow({ where: { editionId_provider: bindingKey } }))
      .url,
    managedUrl,
  );

  const noopPlaylist = await queuePlaylist(1, reviewedUrl);
  assert.equal(
    (await (await decideArtist(noopPlaylist.id)).json()).playlistPublication,
    "unchanged",
  );
  const stalePlaylist = await queuePlaylist(2, null);
  await db.festivalPlaylistLink.update({
    where: { editionId_provider: bindingKey },
    data: { url: otherUrl },
  });
  assert.equal((await decideArtist(stalePlaylist.id)).status, 409);
  assert.ok((await festivalPage()).includes(otherUrl));

  assert.equal(
    (await admin.json(`/api/admin/drafts/${stalePlaylist.draftId}`, "DELETE")).status,
    200,
  );
  const removal = await queuePlaylist(2, null);
  assert.equal((await (await decideArtist(removal.id)).json()).playlistPublication, "removed");
  assert.ok((await festivalPage()).includes(managedUrl));
  assert.equal(await db.catalogPlaylistRefresh.count(), pendingProviderJobs);

  const refreshPath = "/api/admin/refresh/wacken-open-air";
  assert.equal((await admin.json(`${refreshPath}?year=2026`, "POST")).status, 404);
  assert.deepEqual(requests, []);

  const refresh = await admin.json(`${refreshPath}?year=2027`, "POST");
  assert.equal(refresh.status, 201);
  const successfulRun = await refresh.json();
  assert.equal(successfulRun.editionYear, 2027);
  assert.equal(successfulRun.status, "PARTIAL");
  assert.equal(successfulRun.checked, 2);
  assert.equal(successfulRun.failed, 1);
  assert.equal(successfulRun.queued, 1);
  assert.deepEqual([...new Set(requests)].sort(), ["/dates", "/failing", "/primary"]);
  datesChanged = true;
  const followup = await admin.json(`${refreshPath}?year=2027`, "POST");
  assert.equal(followup.status, 201);
  assert.equal((await followup.json()).queued, 1);
  const observations = await db.adminChange.findMany({
    where: { resourceKey: "wacken-open-air", parserRunId: { not: null } },
  });
  const ticketChange = observations.find(({ field }) => field === "ticketStatus");
  const datesChange = observations.find(({ field }) => field === "startDate");
  assert.equal(observations.length, 2);
  assert.ok(ticketChange && datesChange);
  assert.notEqual(ticketChange.parserRunId, datesChange.parserRunId);
  assert.notEqual(ticketChange.sourceEvidence.refreshId, datesChange.sourceEvidence.refreshId);
  assert.equal(ticketChange.field, "ticketStatus");
  assert.equal(ticketChange.beforeValue, "unknown");
  assert.equal(ticketChange.afterValue, "sold_out");
  assert.equal(ticketChange.sourceEvidence.editionYear, 2027);
  assert.equal(ticketChange.sourceEvidence.evidence[0].sourceUrl, sourceOrigin + "/primary");

  async function publicAvailability() {
    const response = await anonymous.json("/festivals/wacken-open-air/");
    assert.equal(response.status, 200);
    const page = await response.text();
    const event = [...page.matchAll(/<script type="application\/ld\+json">(.*?)<\/script>/gs)]
      .map((match) => JSON.parse(match[1]))
      .find((entry) => entry["@type"] === "MusicEvent");
    assert.ok(event);
    return event.offers?.availability;
  }
  assert.equal(await publicAvailability(), undefined);

  // Legacy proposals could accidentally publish to a later edition whose prior
  // value happened to match. Even an otherwise valid review cannot bind them.
  const legacyRun = await db.adminParserRun.create({
    data: {
      festivalSlug: "wacken-open-air",
      sourceId: sourceOrigin + "/primary",
      adapter: "json_ld_event",
      status: "SUCCEEDED",
      log: [],
    },
  });
  const legacyChange = await db.adminChange.create({
    data: {
      resourceKind: "FESTIVAL",
      resourceKey: "wacken-open-air",
      field: "ticketStatus",
      beforeValue: ticketChange.beforeValue,
      afterValue: ticketChange.afterValue,
      baseRevision: ticketChange.baseRevision,
      parserRunId: legacyRun.id,
      sourceEvidence: ticketChange.sourceEvidence.evidence,
    },
  });
  const legacyPath = `/api/admin/changes/${legacyChange.id}`;
  const unbound = await admin.json(legacyPath, "POST", { decision: "approve" });
  assert.equal(unbound.status, 409);
  assert.match(await unbound.text(), /missing its edition binding/);
  assert.equal(
    (await db.adminChange.findUniqueOrThrow({ where: { id: legacyChange.id } })).status,
    "PENDING",
  );
  assert.equal(
    await db.catalogPublication.count({ where: { sourceId: `admin:${legacyChange.id}` } }),
    0,
  );
  assert.equal(await publicAvailability(), undefined);
  assert.equal((await admin.json(legacyPath, "POST", { decision: "reject" })).status, 200);

  const attempts = requests.filter((path) => path === "/failing").length;
  const replay = await admin.json(`${refreshPath}?year=2027`, "POST");
  assert.equal(replay.status, 201);
  const repeated = await replay.json();
  assert.equal(repeated.skipped, 1);
  assert.equal(repeated.queued, 0);
  assert.equal(requests.filter((path) => path === "/failing").length, attempts);

  // Normal ingestion may already have applied a reviewed value.
  await db.festivalEdition.update({
    where: { id: datesChange.sourceEvidence.editionId },
    data: { startDate: new Date(`${correctedStartDate}T00:00:00Z`) },
  });
  const approveDates = await admin.json(`/api/admin/changes/${datesChange.id}`, "POST", {
    decision: "approve",
  });
  assert.equal(approveDates.status, 200);
  assert.equal((await approveDates.json()).catalogPublicationId, null);

  const approvePath = `/api/admin/changes/${ticketChange.id}`;
  assert.equal((await admin.json(approvePath, "POST", { decision: "approve" })).status, 200);
  assert.equal((await admin.json(approvePath, "POST", { decision: "approve" })).status, 409);
  assert.equal(await publicAvailability(), "https://schema.org/SoldOut");
  const publication = await db.catalogPublication.findUniqueOrThrow({
    where: { sourceId: `admin:${ticketChange.id}` },
  });
  assert.deepEqual(publication.fields, ["ticketStatus"]);
  assert.equal(publication.editionYear, 2027);
  assert.equal(
    await db.catalogPlaylistRefresh.count({ where: { publicationId: publication.id } }),
    0,
  );
  originalStartDate = correctedStartDate;
  const afterApproval = await admin.json(`${refreshPath}?year=2027`, "POST");
  assert.equal(afterApproval.status, 201);
  assert.equal((await afterApproval.json()).queued, 0);

  const configuredSource = await db.festivalSource.findUniqueOrThrow({
    where: {
      festivalSlug_url: { festivalSlug: "wacken-open-air", url: sourceOrigin + "/primary" },
    },
  });
  await db.festivalSource.updateMany({
    where: { festivalSlug: "wacken-open-air", editionYear: 2027 },
    data: { enabled: false },
  });
  const beforeDisabledRuns = await db.adminParserRun.count();
  assert.equal((await admin.json(refreshPath, "POST")).status, 409);
  assert.equal(await db.adminParserRun.count(), beforeDisabledRuns);
  await db.festivalSource.update({ where: { id: configuredSource.id }, data: { enabled: true } });
  // A current source configuration cannot establish the year of a dateless offer.
  primaryOffersWithoutEdition = true;
  observedTicketsUrl = replacementTicketsUrl;
  const unscopedStock = await admin.json(`${refreshPath}?year=2027`, "POST");
  assert.equal(unscopedStock.status, 201);
  const stockRun = await unscopedStock.json();
  assert.equal(stockRun.queued, 0);
  assert.equal(stockRun.status, "PARTIAL");
  const stockLog = await (await admin.json(`/api/admin/parser-runs/${stockRun.id}/log`)).json();
  assert.ok(
    stockLog.log.some(({ reviewReasons }) =>
      reviewReasons?.includes(
        "Ticket availability could not be verified for the selected edition.",
      ),
    ),
  );
  assert.equal(
    await db.adminChange.count({ where: { parserRunId: stockRun.id, field: "ticketStatus" } }),
    0,
  );
  assert.equal(await publicAvailability(), "https://schema.org/SoldOut");
  assert.equal(
    await db.adminChange.count({ where: { parserRunId: stockRun.id, field: "ticketsUrl" } }),
    0,
  );
  assert.ok(
    stockLog.log.some(({ reviewReasons }) =>
      reviewReasons?.includes("Ticket URL could not be verified for the selected edition."),
    ),
  );
  assert.equal(
    (await db.festivalEdition.findUniqueOrThrow({ where: { id: configuredSource.editionId } }))
      .ticketsUrl,
    ticketsUrl,
  );

  // A separate parser can date the page without dating the offer it did not extract.
  primaryHasDatedFallback = true;
  const mixedOffer = await admin.json(`${refreshPath}?year=2027`, "POST");
  assert.equal(mixedOffer.status, 201);
  const mixedRun = await mixedOffer.json();
  assert.equal(mixedRun.queued, 0);
  assert.equal(mixedRun.status, "PARTIAL");

  // The same link is eligible once the official event establishes the selected year.
  primaryOffersWithoutEdition = false;
  const scopedLink = await admin.json(`${refreshPath}?year=2027`, "POST");
  assert.equal(scopedLink.status, 201);
  const linkRun = await scopedLink.json();
  assert.equal(linkRun.queued, 1);
  const linkChange = await db.adminChange.findFirstOrThrow({
    where: { parserRunId: linkRun.id, field: "ticketsUrl" },
  });
  assert.equal(linkChange.afterValue, replacementTicketsUrl);
  assert.equal(
    (await admin.json(`/api/admin/changes/${linkChange.id}`, "POST", { decision: "approve" }))
      .status,
    200,
  );
  assert.equal(
    (await db.festivalEdition.findUniqueOrThrow({ where: { id: configuredSource.editionId } }))
      .ticketsUrl,
    replacementTicketsUrl,
  );

  // A date from the HTML parser does not establish the edition of a JSON-LD roster.
  primaryOffersWithoutEdition = true;
  includePerformer = true;
  const unscopedLineup = await admin.json(`${refreshPath}?year=2027`, "POST");
  assert.equal(unscopedLineup.status, 201);
  const unscopedLineupRun = await unscopedLineup.json();
  assert.equal(unscopedLineupRun.queued, 0);
  assert.equal(unscopedLineupRun.status, "PARTIAL");
  const lineupLog = await (
    await admin.json(`/api/admin/parser-runs/${unscopedLineupRun.id}/log`)
  ).json();
  assert.ok(
    lineupLog.log.some(({ reviewReasons }) =>
      reviewReasons?.includes("Lineup could not be verified for the selected edition."),
    ),
  );

  primaryOffersWithoutEdition = false;
  const scopedLineup = await admin.json(`${refreshPath}?year=2027`, "POST");
  assert.equal(scopedLineup.status, 201);
  const scopedLineupRun = await scopedLineup.json();
  assert.equal(scopedLineupRun.queued, 1);
  const scopedLineupChange = await db.adminChange.findFirstOrThrow({
    where: { parserRunId: scopedLineupRun.id, field: "lineup" },
  });
  assert.deepEqual(scopedLineupChange.afterValue, [performer]);
  assert.equal(
    (
      await admin.json(`/api/admin/changes/${scopedLineupChange.id}`, "POST", {
        decision: "approve",
      })
    ).status,
    200,
  );
  assert.match(
    await (await anonymous.json("/festivals/wacken-open-air/")).text(),
    /Example Metal Band/,
  );
  includePerformer = false;

  // A date from the HTML parser does not date a different parser's venue.
  primaryOffersWithoutEdition = true;
  observedCity = "Example Festival City";
  const unscopedCity = await admin.json(`${refreshPath}?year=2027`, "POST");
  assert.equal(unscopedCity.status, 201);
  const unscopedCityRun = await unscopedCity.json();
  assert.equal(unscopedCityRun.queued, 0);
  assert.equal(unscopedCityRun.status, "PARTIAL");
  const cityLog = await (
    await admin.json(`/api/admin/parser-runs/${unscopedCityRun.id}/log`)
  ).json();
  assert.ok(
    cityLog.log.some(({ reviewReasons }) =>
      reviewReasons?.includes("City could not be verified for the selected edition."),
    ),
  );

  primaryOffersWithoutEdition = false;
  primaryStartDate = "2027-02-29";
  const invalidDate = await admin.json(`${refreshPath}?year=2027`, "POST");
  assert.equal(invalidDate.status, 201);
  const invalidDateRun = await invalidDate.json();
  assert.equal(invalidDateRun.queued, 0);
  const invalidDateLog = await (
    await admin.json(`/api/admin/parser-runs/${invalidDateRun.id}/log`)
  ).json();
  assert.ok(
    invalidDateLog.log.some(({ reviewReasons }) =>
      reviewReasons?.includes("JSON-LD Event contains an invalid start date"),
    ),
  );
  primaryStartDate = undefined;

  includeAnotherEvent = true;
  const ambiguousCity = await admin.json(`${refreshPath}?year=2027`, "POST");
  assert.equal(ambiguousCity.status, 201);
  const ambiguousRun = await ambiguousCity.json();
  assert.equal(ambiguousRun.queued, 0);
  assert.equal(ambiguousRun.status, "PARTIAL");
  const ambiguousLog = await (
    await admin.json(`/api/admin/parser-runs/${ambiguousRun.id}/log`)
  ).json();
  assert.ok(
    ambiguousLog.log.some(({ reviewReasons }) =>
      reviewReasons?.some((reason) => reason.includes("Multiple JSON-LD Events")),
    ),
  );
  includeAnotherEvent = false;

  const scopedCity = await admin.json(`${refreshPath}?year=2027`, "POST");
  assert.equal(scopedCity.status, 201);
  const scopedCityRun = await scopedCity.json();
  assert.equal(scopedCityRun.queued, 1);
  const scopedCityChange = await db.adminChange.findFirstOrThrow({
    where: { parserRunId: scopedCityRun.id, field: "city" },
  });
  assert.equal(scopedCityChange.afterValue, observedCity);
  assert.equal(
    (await admin.json(`/api/admin/changes/${scopedCityChange.id}`, "POST", { decision: "approve" }))
      .status,
    200,
  );
  assert.equal(
    (await db.festival.findUniqueOrThrow({ where: { slug: "wacken-open-air" } })).city,
    observedCity,
  );

  primaryFails = true;
  assert.equal((await admin.json(refreshPath, "POST")).status, 502);
  const failedRun = await db.adminParserRun.findFirstOrThrow({ orderBy: { startedAt: "desc" } });
  assert.equal(failedRun.status, "FAILED");
  assert.equal(await publicAvailability(), "https://schema.org/SoldOut");
  const logResponse = await admin.json(`/api/admin/parser-runs/${failedRun.id}/log`);
  assert.equal(logResponse.status, 200);
  const storedLog = await logResponse.json();
  assert.equal(storedLog.id, failedRun.id);
  assert.equal(storedLog.status, "FAILED");
  assert.deepEqual(storedLog.log, failedRun.log);
  assert.equal((await admin.json("/api/admin/parser-runs/missing/log")).status, 404);

  const conflictA = await db.adminChange.create({
    data: {
      resourceKind: "LINK",
      resourceKey: "concurrent",
      field: "url",
      baseRevision: 0,
      beforeValue: null,
      afterValue: "https://a.example",
      sourceEvidence: { test: true },
    },
  });
  const conflictB = await db.adminChange.create({
    data: {
      resourceKind: "LINK",
      resourceKey: "concurrent",
      field: "url",
      baseRevision: 0,
      beforeValue: null,
      afterValue: "https://b.example",
      sourceEvidence: { test: true },
    },
  });
  const results = await Promise.all(
    [conflictA, conflictB].map((change) =>
      admin.json(`/api/admin/changes/${change.id}`, "POST", { decision: "approve" }),
    ),
  );
  assert.deepEqual(results.map((response) => response.status).sort(), [200, 409]);
  const published = await db.adminResourceState.findUniqueOrThrow({
    where: { resourceKind_resourceKey: { resourceKind: "LINK", resourceKey: "concurrent" } },
  });
  assert.ok(["https://a.example", "https://b.example"].includes(published.values.url));
  assert.equal(published.revision, 1);

  const audit = await db.adminAuditEntry.findMany({ orderBy: { createdAt: "asc" } });
  assert.ok(audit.some((entry) => entry.action === "DRAFT_UPDATED"));
  assert.ok(audit.some((entry) => entry.action === "DRAFT_DELETED"));
  const approvedAudit = audit.find((entry) => entry.action === "CHANGE_APPROVED");
  assert.equal(approvedAudit.actorLabel, "admin@example.test");
  assert.ok(approvedAudit.evidence);
  await assert.rejects(
    db.adminAuditEntry.update({ where: { id: approvedAudit.id }, data: { action: "TAMPERED" } }),
    /append-only/,
  );
  await assert.rejects(
    db.adminAuditEntry.delete({ where: { id: approvedAudit.id } }),
    /append-only/,
  );
  assert.equal((await admin.json("/api/admin")).status, 200);
  const reviewed = await admin.json(
    `/api/admin/submissions/${persistedSubmission.publicReference}`,
    "POST",
    { decision: "approve", reviewNote: "Official source verified" },
  );
  assert.equal(reviewed.status, 200);
  assert.equal((await reviewed.json()).status, "APPROVED");
  const submissionAudit = await db.festivalSubmissionAudit.findMany({
    where: { submissionId: persistedSubmission.id },
    orderBy: { createdAt: "asc" },
  });
  assert.deepEqual(
    submissionAudit.map((entry) => entry.action),
    ["SUBMITTED", "APPROVED"],
  );
  await assert.rejects(
    db.festivalSubmissionAudit.update({
      where: { id: submissionAudit[1].id },
      data: { action: "TAMPERED" },
    }),
    /append-only/,
  );
});
