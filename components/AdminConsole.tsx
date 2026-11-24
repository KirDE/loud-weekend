"use client";

import { TicketOfferReviewQueue } from "./TicketOfferReviewQueue";
import { AdminBiographyReview } from "./AdminBiographyReview";
import { AdminSocialLinkReview } from "./AdminSocialLinkReview";
import { useEffect, useMemo, useState } from "react";
import type { Festival } from "@/lib/domain/festival";
import type { AuditEntry, ParserRun, ReviewChange } from "@/lib/admin";
import type { NewFestivalDraft } from "./SubmissionNewFestival";
import type { FollowOnDraft } from "./SubmissionFollowOnEdition";
import { SubmissionEditionLink } from "./SubmissionEditionLink";
import type { SubmissionEditionLink as LinkedEdition } from "@/lib/submission-edition-link";
import { useLanguage, type Language, type AdminTranslationKey } from "./LanguageProvider";

type Section = "content" | "review" | "submissions" | "assets" | "diagnostics" | "audit";
type Submission = {
  reference: string;
  name: string;
  year: number;
  officialUrl: string;
  notes: string | null;
  status: "pending" | "approved" | "rejected";
  submittedAt: string;
  editionLink?: LinkedEdition | null;
  followOnDraft?: FollowOnDraft;
  newFestivalDraft?: NewFestivalDraft;
  audit: { action: string; at: string }[];
};
type Notice = { key: AdminTranslationKey; values?: Record<string, string | number> };

function failureKey(status: number, fallback: AdminTranslationKey): AdminTranslationKey {
  if ([401, 403].includes(status)) return "accessDenied";
  if ([400, 422].includes(status)) return "invalidRequest";
  return fallback;
}

type EditableArtist = {
  slug: string;
  name: string;
  officialUrl?: string;
  biography?: string;
  verifiedOfficialSite: boolean;
  socialCandidates: string[];
};
type Operator = { email: string; role: "USER" | "EDITOR" | "ADMIN" };

export function AdminConsole({
  festivals,
  artists,
  initialChanges,
  parserRuns,
  auditEntries,
  submissions: initialSubmissions,
  editionOptions = [],
  sourceHealth = [],
  ticketOfferEditions = [],
}: {
  ticketOfferEditions?: { id: string; year: number }[];
  festivals: Festival[];
  artists: EditableArtist[];
  initialChanges: ReviewChange[];
  parserRuns: ParserRun[];
  auditEntries: AuditEntry[];
  submissions: Submission[];
  editionOptions?: { slug: string; name: string; year: number; current: boolean }[];
  sourceHealth?: {
    id: string;
    festivalSlug: string;
    consecutiveFailures: number;
    failureStartedAt: string | null;
    deprecatedAt: string | null;
    nextRunAt: string | null;
  }[];
}) {
  const [section, setSection] = useState<Section>("review");
  const [selectedSlug, setSelectedSlug] = useState(festivals[0]?.slug ?? "");
  const selected = festivals.find((item) => item.slug === selectedSlug) ?? festivals[0];
  const [changes, setChanges] = useState(initialChanges);
  const [submissions, setSubmissions] = useState(initialSubmissions);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [artistQuery, setArtistQuery] = useState("");
  const [selectedArtistSlug, setSelectedArtistSlug] = useState("");
  const selectedArtist = artists.find(({ slug }) => slug === selectedArtistSlug);
  const [artistDraft, setArtistDraft] = useState<Record<string, string>>({});
  const [festivalDraft, setFestivalDraft] = useState<Record<string, string>>({});
  const [assetDraft, setAssetDraft] = useState<Record<string, string>>({});
  const [operator, setOperator] = useState<Operator | null>(null);
  const [playlistProvider, setPlaylistProvider] = useState<"spotify" | "youtube_music">("spotify");
  const [playlistDraft, setPlaylistDraft] = useState<string | undefined>();
  const reviewedPlaylistUrl = selected?.reviewedPlaylistLinks?.[playlistProvider];
  const [openLog, setOpenLog] = useState<string | null>(null);
  const { language, setLanguage, ta } = useLanguage();
  const matchingArtists = useMemo(
    () =>
      artists
        .filter(({ name }) => name.toLowerCase().includes(artistQuery.toLowerCase()))
        .slice(0, 12),
    [artists, artistQuery],
  );
  useEffect(() => {
    fetch("/api/auth/me", { headers: { accept: "application/json" } })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        const user = body?.user;
        if (user && (user.role === "ADMIN" || user.role === "EDITOR" || user.role === "USER"))
          setOperator({ email: user.email, role: user.role });
      })
      .catch(() => undefined);
  }, []);

  const decide = async (id: string, status: "approved" | "rejected") => {
    try {
      const response = await fetch(`/api/admin/changes/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: status === "approved" ? "approve" : "reject" }),
      });
      if (!response.ok) return setNotice({ key: failureKey(response.status, "decisionFailed") });
      setChanges((items) => items.map((item) => (item.id === id ? { ...item, status } : item)));
      setNotice({ key: "decisionNotice" });
    } catch {
      setNotice({ key: "decisionFailed" });
    }
  };

  const decideSubmission = async (reference: string, status: "approved" | "rejected") => {
    try {
      const response = await fetch(`/api/admin/submissions/${reference}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: status === "approved" ? "approve" : "reject" }),
      });
      if (!response.ok) return setNotice({ key: failureKey(response.status, "submissionFailed") });
      setSubmissions((items) =>
        items.map((item) => (item.reference === reference ? { ...item, status } : item)),
      );
      setNotice({ key: "decisionNotice" });
    } catch {
      setNotice({ key: "submissionFailed" });
    }
  };

  const refresh = async () => {
    if (!selected) return;
    setRefreshing(true);
    setNotice(null);
    try {
      const query = selected.editionYear ? `?year=${selected.editionYear}` : "";
      const response = await fetch(`/api/admin/refresh/${selected.slug}${query}`, {
        method: "POST",
      });
      if (!response.ok) return setNotice({ key: failureKey(response.status, "refreshFailed") });
      const body = await response.json();
      setNotice({
        key: body.status === "PARTIAL" ? "refreshWarning" : "refreshResult",
        values: { festival: selected.name },
      });
    } catch {
      setNotice({ key: "refreshFailed" });
    } finally {
      setRefreshing(false);
    }
  };

  const save = async (
    resourceKind: "festival" | "artist" | "link" | "asset" | "playlist",
    resourceKey: string,
    values: Record<string, unknown>,
  ) => {
    let baseRevision: number;
    try {
      const response = await fetch("/api/admin");
      if (!response.ok)
        return setNotice({ key: failureKey(response.status, "revisionLoadFailed") });
      const snapshot = await response.json();
      const resource = snapshot.resources.find(
        (item: { resourceKind: string; resourceKey: string }) =>
          item.resourceKind === resourceKind.toUpperCase() && item.resourceKey === resourceKey,
      );
      baseRevision = resource?.revision ?? 0;
    } catch {
      return setNotice({ key: "revisionLoadFailed" });
    }

    try {
      const response = await fetch("/api/admin", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ resourceKind, resourceKey, baseRevision, values }),
      });
      if (!response.ok) return setNotice({ key: failureKey(response.status, "draftSaveFailed") });
      const body = await response.json();
      setNotice({ key: "draftRevisionSaved", values: { revision: body.revision } });
    } catch {
      setNotice({ key: "draftSaveFailed" });
    }
  };

  const pending = changes.filter((item) => item.status === "pending").length;
  const pendingSubmissions = submissions.filter((item) => item.status === "pending").length;
  const unhealthySources = sourceHealth.filter(
    (source) => source.consecutiveFailures > 0 || source.deprecatedAt,
  );
  return (
    <div className="adminShell">
      <nav className="adminNav" aria-label={ta("navigation")}>
        <div>
          <div className="eyebrow">Loud Weekend</div>
          <h1>{ta("console")}</h1>
          <p>{ta("subtitle")}</p>
        </div>
        {(["review", "submissions", "content", "assets", "diagnostics", "audit"] as Section[]).map(
          (id) => (
            <button
              type="button"
              key={id}
              className={section === id ? "active" : ""}
              aria-current={section === id ? "page" : undefined}
              onClick={() => setSection(id)}
            >
              {ta(id)}
              {id === "review" && <b aria-label={`${pending} ${ta("pendingCount")}`}>{pending}</b>}
              {id === "submissions" && <b>{pendingSubmissions}</b>}
            </button>
          ),
        )}
        <label className="adminLanguage">
          <span>{ta("language")}</span>
          <select
            value={language}
            onChange={(event) => setLanguage(event.target.value as Language)}
          >
            <option value="en">English</option>
            <option value="de">Deutsch</option>
            <option value="ru">Русский</option>
          </select>
        </label>
        <a href="/">← {ta("publicSite")}</a>
      </nav>
      <section className="adminMain">
        <header className="adminHeader">
          <div>
            <div className="eyebrow">{ta("operations")}</div>
            <h2>
              {section === "review"
                ? ta("detectedChanges")
                : section === "content"
                  ? ta("contentEditor")
                  : ta(section)}
            </h2>
          </div>
          {operator && (
            <span className="adminRole">
              <strong>
                {ta(
                  operator.role === "ADMIN"
                    ? "roleAdmin"
                    : operator.role === "EDITOR"
                      ? "roleEditor"
                      : "roleUser",
                )}
              </strong>
              <small>{operator.email}</small>
            </span>
          )}
        </header>
        {notice && (
          <div className="adminNotice" role="status" aria-live="polite">
            {ta(notice.key, notice.values)}
            <button onClick={() => setNotice(null)} aria-label={ta("dismiss")}>
              ×
            </button>
          </div>
        )}

        {section === "review" && (
          <div className="reviewList">
            {ticketOfferEditions.map((edition) => (
              <TicketOfferReviewQueue
                key={edition.id}
                editionId={edition.id}
                year={edition.year}
                locale={language}
              />
            ))}
            <div className="adminToolbar">
              <p>{ta("reviewHelp")}</p>
              <select aria-label={ta("filter")}>
                <option>{ta("allPending")}</option>
                <option>{ta("conflicts")}</option>
                <option>{ta("highConfidence")}</option>
              </select>
            </div>
            {!changes.length && <p>{ta("noChanges")}</p>}
            {changes.map((change) => (
              <article className={`reviewCard ${change.status}`} key={change.id}>
                <div className="reviewMeta">
                  <span className={change.conflict ? "risk" : "safe"}>
                    {change.conflict ? ta("conflict") : `${change.confidence}% ${ta("confidence")}`}
                  </span>
                  <small>
                    {change.id} · {change.source}
                  </small>
                </div>
                <h3>
                  {change.festival} <span>· {change.field}</span>
                </h3>
                <div className="diff">
                  <div>
                    <small>{ta("current")}</small>
                    <p>{change.current}</p>
                  </div>
                  <div>
                    <small>{ta("detected")}</small>
                    <p>{change.detected}</p>
                  </div>
                </div>
                {change.status === "pending" ? (
                  <div className="reviewActions">
                    <button className="secondary" onClick={() => decide(change.id, "rejected")}>
                      {ta("reject")}
                    </button>
                    <button onClick={() => decide(change.id, "approved")}>{ta("approve")}</button>
                  </div>
                ) : (
                  <strong className="decision">{ta(change.status)}</strong>
                )}
              </article>
            ))}
          </div>
        )}

        {section === "submissions" && (
          <div className="reviewList">
            {!submissions.length && <p>{ta("noSubmissions")}</p>}
            {submissions.map((item) => (
              <article className={`reviewCard ${item.status}`} key={item.reference}>
                <div className="reviewMeta">
                  <span className={item.status === "pending" ? "risk" : "safe"}>
                    {ta(item.status)}
                  </span>
                  <small>
                    {item.reference} · {item.submittedAt}
                  </small>
                </div>
                <h3>
                  {item.name} <span>· {item.year}</span>
                </h3>
                <p>
                  <a href={item.officialUrl} rel="noreferrer" target="_blank">
                    {item.officialUrl}
                  </a>
                </p>
                <p>{item.notes || ta("noNotes")}</p>
                {item.audit.length > 0 && (
                  <p>
                    {ta("submissionHistory")}:{" "}
                    {item.audit.map((entry) => `${entry.action} ${entry.at}`).join(" · ")}
                  </p>
                )}
                {item.status === "pending" && (
                  <div className="reviewActions">
                    <button
                      className="secondary"
                      onClick={() => decideSubmission(item.reference, "rejected")}
                    >
                      {ta("reject")}
                    </button>
                    <button onClick={() => decideSubmission(item.reference, "approved")}>
                      {ta("approveSubmission")}
                    </button>
                  </div>
                )}
                {item.status === "approved" && (
                  <SubmissionEditionLink
                    reference={item.reference}
                    year={item.year}
                    editions={editionOptions}
                    currentEditions={editionOptions.filter((entry) => entry.current)}
                    draft={item.followOnDraft}
                    onDraft={(followOnDraft) =>
                      setSubmissions((items) =>
                        items.map((submission) =>
                          submission.reference === item.reference
                            ? { ...submission, followOnDraft }
                            : submission,
                        ),
                      )
                    }
                    link={item.editionLink}
                    newFestivalDraft={item.newFestivalDraft}
                    onNewFestivalDraft={(newFestivalDraft) =>
                      setSubmissions((items) =>
                        items.map((submission) =>
                          submission.reference === item.reference
                            ? { ...submission, newFestivalDraft }
                            : submission,
                        ),
                      )
                    }
                    onLinked={(editionLink) =>
                      setSubmissions((items) =>
                        items.map((submission) =>
                          submission.reference === item.reference
                            ? { ...submission, editionLink }
                            : submission,
                        ),
                      )
                    }
                  />
                )}
              </article>
            ))}
          </div>
        )}

        {(section === "content" || section === "assets") && !selected && <p>{ta("noFestivals")}</p>}

        {section === "content" && selected && (
          <div className="editorGrid">
            <div className="adminPanel">
              {selected.sourceDeprecated && (
                <p className="risk">
                  {ta("deprecated")} · {selected.sourceDeprecatedAt} · {ta("diagnostics")}
                </p>
              )}
              <label>
                {ta("festival")}
                <select
                  value={selectedSlug}
                  onChange={(event) => {
                    setSelectedSlug(event.target.value);
                    setFestivalDraft({});
                  }}
                >
                  {festivals.map((item) => (
                    <option value={item.slug} key={item.slug}>
                      {item.name}
                      {item.sourceDeprecated ? ` · ${ta("deprecated")}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <div className="fieldPair">
                <label>
                  {ta("name")}
                  <input
                    defaultValue={selected.name}
                    onChange={(e) => setFestivalDraft((v) => ({ ...v, name: e.target.value }))}
                  />
                </label>
                <label>
                  {ta("status")}
                  <select
                    defaultValue={selected.status}
                    onChange={(e) => setFestivalDraft((v) => ({ ...v, status: e.target.value }))}
                  >
                    {(["confirmed", "partial", "tba"] as const).map((status) => (
                      <option value={status} key={status}>
                        {ta(status)}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="fieldPair">
                <label>
                  {ta("city")}
                  <input
                    defaultValue={selected.city}
                    onChange={(e) => setFestivalDraft((v) => ({ ...v, city: e.target.value }))}
                  />
                </label>
                <label>
                  {ta("country")}
                  <input
                    defaultValue={selected.country}
                    onChange={(e) => setFestivalDraft((v) => ({ ...v, country: e.target.value }))}
                  />
                </label>
              </div>
              <div className="fieldPair">
                <label>
                  {ta("startDate")}
                  <input
                    type="date"
                    defaultValue={selected.startDate}
                    onChange={(e) => setFestivalDraft((v) => ({ ...v, startDate: e.target.value }))}
                  />
                </label>
                <label>
                  {ta("endDate")}
                  <input
                    type="date"
                    defaultValue={selected.endDate}
                    onChange={(e) => setFestivalDraft((v) => ({ ...v, endDate: e.target.value }))}
                  />
                </label>
              </div>
              <label>
                {ta("headliners")}
                <textarea
                  defaultValue={selected.headliners.join("\n")}
                  rows={5}
                  onChange={(e) => setFestivalDraft((v) => ({ ...v, headliners: e.target.value }))}
                />
              </label>
              <button
                disabled={!Object.keys(festivalDraft).length}
                onClick={() => save("festival", selected.slug, festivalDraft)}
              >
                {ta("saveFestival")}
              </button>
            </div>
            <div>
              {operator?.role === "ADMIN" && (
                <div className="adminPanel">
                  <h3>{ta("manualRefresh")}</h3>
                  <p>{ta("refreshHelp")}</p>
                  <button onClick={refresh} disabled={refreshing}>
                    {refreshing
                      ? ta("refreshing")
                      : ta("refreshFestivalAction", { festival: selected.name })}
                  </button>
                </div>
              )}
              <div className="adminPanel">
                <h3>{ta("artistEditor")}</h3>
                <input
                  aria-label={ta("findArtist")}
                  placeholder={ta("findArtist")}
                  value={artistQuery}
                  onChange={(event) => setArtistQuery(event.target.value)}
                />
                {!artists.length && <p>{ta("noArtistsFound")}</p>}
                <ul className="artistAdminList">
                  {matchingArtists.map((artist) => (
                    <li key={artist.slug}>
                      <span>{artist.name}</span>
                      <button
                        className="textButton"
                        onClick={() => {
                          setSelectedArtistSlug(artist.slug);
                          setArtistDraft({});
                        }}
                      >
                        {ta("edit")}
                      </button>
                    </li>
                  ))}
                </ul>
                {selectedArtist && (
                  <div key={selectedArtist.slug}>
                    <strong>{selectedArtist.name}</strong>
                    <label>
                      {ta("canonicalName")}
                      <input
                        defaultValue={selectedArtist.name}
                        onChange={(event) =>
                          setArtistDraft((value) => ({
                            ...value,
                            canonicalName: event.target.value,
                          }))
                        }
                      />
                    </label>
                    <label>
                      {ta("officialUrl")}
                      <input
                        type="url"
                        defaultValue={selectedArtist.officialUrl}
                        placeholder="https://…"
                        onChange={(event) =>
                          setArtistDraft((value) => ({ ...value, officialUrl: event.target.value }))
                        }
                      />
                    </label>
                    <button
                      disabled={!Object.keys(artistDraft).length}
                      onClick={() => save("artist", selectedArtist.slug, artistDraft)}
                    >
                      {ta("saveArtist")}
                    </button>
                    {selectedArtist.verifiedOfficialSite && (
                      <AdminBiographyReview
                        biography={selectedArtist.biography}
                        onSave={(proof) =>
                          save("artist", selectedArtist.slug, { biography: proof })
                        }
                      />
                    )}
                    {selectedArtist.socialCandidates.length > 0 && (
                      <AdminSocialLinkReview
                        key={selectedArtist.slug}
                        candidates={selectedArtist.socialCandidates}
                        onSave={(proof) =>
                          save("artist", selectedArtist.slug, { socialProfile: proof })
                        }
                      />
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {section === "assets" && selected && (
          <div className="editorGrid">
            <div className="adminPanel">
              {selected.sourceDeprecated && (
                <p className="risk">
                  {ta("deprecated")} · {selected.sourceDeprecatedAt} · {ta("diagnostics")}
                </p>
              )}
              <label>
                {ta("festival")}
                <select
                  value={selectedSlug}
                  onChange={(event) => {
                    setSelectedSlug(event.target.value);
                    setAssetDraft({});
                    setPlaylistDraft(undefined);
                  }}
                >
                  {festivals.map((item) => (
                    <option value={item.slug} key={item.slug}>
                      {item.name}
                      {item.sourceDeprecated ? ` · ${ta("deprecated")}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              {(
                [
                  ["officialUrl", selected.officialUrl],
                  ["ticketsUrl", selected.ticketsUrl],
                ] as const
              ).map(([field, value]) => (
                <label key={field}>
                  {ta(field)}
                  <input
                    type="url"
                    defaultValue={value}
                    placeholder="https://…"
                    onChange={(e) => setAssetDraft((v) => ({ ...v, [field]: e.target.value }))}
                  />
                </label>
              ))}
              <button
                disabled={!Object.keys(assetDraft).some((field) => field !== "logoAssetHash")}
                onClick={() =>
                  save(
                    "link",
                    selected.slug,
                    Object.fromEntries(
                      Object.entries(assetDraft).filter(([field]) => field !== "logoAssetHash"),
                    ),
                  )
                }
              >
                {ta("saveLinks")}
              </button>
              <label>
                {ta("reviewedLogoHash")}
                <input
                  key={selected.slug}
                  value={assetDraft.logoAssetHash ?? ""}
                  onChange={(event) =>
                    setAssetDraft((value) => ({ ...value, logoAssetHash: event.target.value }))
                  }
                />
              </label>
              <button
                disabled={!/^[a-f0-9]{64}$/.test(assetDraft.logoAssetHash ?? "")}
                onClick={() =>
                  save("asset", selected.slug, { logoAssetHash: assetDraft.logoAssetHash })
                }
              >
                {ta("saveLogoDraft")}
              </button>
            </div>
            <div>
              <div className="adminPanel">
                <h3>{ta("playlistEditor")}</h3>
                <p>{ta("playlistPublicationReview")}</p>
                <label>
                  {ta("platform")}
                  <select
                    value={playlistProvider}
                    onChange={(event) => {
                      setPlaylistProvider(
                        event.target.value === "youtube_music" ? "youtube_music" : "spotify",
                      );
                      setPlaylistDraft(undefined);
                    }}
                  >
                    <option value="spotify">Spotify</option>
                    <option value="youtube_music">YouTube Music</option>
                  </select>
                </label>
                <label>
                  {ta("playlistAddress")}
                  <input
                    type="url"
                    value={playlistDraft ?? reviewedPlaylistUrl ?? ""}
                    onChange={(event) => setPlaylistDraft(event.target.value)}
                  />
                </label>
                <button
                  disabled={!selected.editionYear || !playlistDraft?.trim()}
                  onClick={() =>
                    save(
                      "playlist",
                      `${selected.slug}:${selected.editionYear}:${playlistProvider}`,
                      { url: playlistDraft?.trim() ?? null },
                    )
                  }
                >
                  {ta("savePlaylist")}
                </button>
                {reviewedPlaylistUrl && selected.editionYear && (
                  <button
                    onClick={() =>
                      save(
                        "playlist",
                        `${selected.slug}:${selected.editionYear}:${playlistProvider}`,
                        { url: null },
                      )
                    }
                  >
                    {ta("removeReviewedPlaylist")}
                  </button>
                )}
              </div>
              <div className="adminPanel assetPreview">
                <h3>{ta("validation")}</h3>
                <p>{ta("assetReviewHelp")}</p>
              </div>
            </div>
          </div>
        )}

        {section === "diagnostics" && (
          <div className="diagnosticGrid">
            {!unhealthySources.length && !parserRuns.length && <p>{ta("noDiagnostics")}</p>}
            {unhealthySources.map((source) => (
              <article className="adminPanel" key={source.id}>
                <span className="risk">{ta(source.deprecatedAt ? "deprecated" : "retry")}</span>
                <h3>{source.festivalSlug}</h3>
                <p>
                  {ta("failures")}: {source.consecutiveFailures} · {ta("since")}:{" "}
                  {source.failureStartedAt ?? "—"} · {ta("nextCheck")}: {source.nextRunAt ?? "—"}
                </p>
              </article>
            ))}
            {parserRuns.map((run, index) => {
              const logId = `parser-log-${index}`;
              return (
                <article className="adminPanel" key={logId}>
                  <div className="reviewMeta">
                    <span className={run.status === "healthy" ? "safe" : "risk"}>
                      {ta(run.status)}
                    </span>
                    <small>{run.lastRun}</small>
                  </div>
                  <h3>{run.festival}</h3>
                  {run.message && (
                    <p>
                      {ta("parserOutput")}: {run.message}
                    </p>
                  )}
                  <dl>
                    <div>
                      <dt>{ta("adapter")}</dt>
                      <dd>{run.source}</dd>
                    </div>
                    <div>
                      <dt>{ta("duration")}</dt>
                      <dd>{run.durationMs} ms</dd>
                    </div>
                    <div>
                      <dt>{ta("records")}</dt>
                      <dd>{run.extracted}</dd>
                    </div>
                  </dl>
                  <button
                    className="secondary"
                    aria-expanded={openLog === logId}
                    aria-controls={logId}
                    onClick={() => setOpenLog((value) => (value === logId ? null : logId))}
                  >
                    {ta("viewLog")}
                  </button>
                  {openLog === logId && (
                    <pre
                      id={logId}
                      tabIndex={0}
                      aria-label={ta("parserLog", { festival: run.festival })}
                    >
                      {JSON.stringify(run.log, null, 2)}
                    </pre>
                  )}
                </article>
              );
            })}
          </div>
        )}

        {section === "audit" && (
          <div className="adminPanel auditTable">
            {!auditEntries.length && <p>{ta("noAudit")}</p>}
            {auditEntries.map((entry) => (
              <article key={entry.id}>
                <time>{entry.at}</time>
                <div>
                  <strong>{entry.action}</strong>
                  <p>
                    {entry.target} · {entry.detail}
                  </p>
                </div>
                <span>{entry.actor}</span>
              </article>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
