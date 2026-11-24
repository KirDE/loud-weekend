import { readNewFestivalDraft } from "@/lib/submission-new-festival";
import { readFollowOnDraft } from "@/lib/submission-follow-on-edition";
import { readSubmissionEditionLink } from "@/lib/submission-edition-link";
import { AdminConsole } from "@/components/AdminConsole";
import { currentAdmin } from "@/lib/admin-access";
import { adminSnapshot } from "@/lib/admin-store";
import { getCatalog } from "@/lib/catalog/repository";
import { db } from "@/lib/db";
import { listTicketOfferReviewEditions } from "@/lib/ingestion/ticket-offer-proposal-store";
import { redirect } from "next/navigation";

export const metadata = { title: "Administration | Loud Weekend" };
export const dynamic = "force-dynamic";

export default async function AdminPage() {
  if (!(await currentAdmin())) redirect("/?admin=forbidden");
  const [snapshot, { festivals, editions, artists }, ticketOfferEditions] = await Promise.all([
    adminSnapshot(),
    getCatalog(),
    listTicketOfferReviewEditions(db),
  ]);
  return (
    <AdminConsole
      ticketOfferEditions={ticketOfferEditions}
      editionOptions={editions.map(({ slug, name, editionYear, recordState }) => ({
        slug,
        name,
        year: editionYear,
        current: recordState === "current",
      }))}
      sourceHealth={snapshot.sourceHealth.map((s) => ({
        ...s,
        failureStartedAt: s.failureStartedAt?.toISOString() ?? null,
        deprecatedAt: s.deprecatedAt?.toISOString() ?? null,
        nextRunAt: s.nextRunAt?.toISOString() ?? null,
      }))}
      submissions={snapshot.submissions.map((item) => ({
        reference: item.publicReference,
        name: item.name,
        year: item.editionYear,
        officialUrl: item.officialUrl,
        notes: item.notes,
        status: item.status.toLowerCase() as "pending" | "approved" | "rejected",
        submittedAt: item.submittedAt.toISOString(),
        editionLink: readSubmissionEditionLink(item.audit),
        followOnDraft: readFollowOnDraft(item.audit),
        newFestivalDraft: readNewFestivalDraft(item.audit),
        audit: item.audit.map((entry) => ({
          action: entry.action,
          at: entry.createdAt.toISOString(),
        })),
      }))}
      festivals={festivals}
      artists={artists.map(({ slug, name, biography, links }) => ({
        slug,
        name,
        biography,
        verifiedOfficialSite: links.some(
          ({ label, source, verified }) =>
            label === "Official site" && source === "official" && verified,
        ),
        officialUrl: links.find(
          ({ label, source }) => label === "Official site" && source === "official",
        )?.url,
        socialCandidates: links
          .filter(
            ({ label, source, verified }) =>
              label === "Social profile" && source === "musicbrainz" && !verified,
          )
          .map(({ url }) => url),
      }))}
      initialChanges={snapshot.changes.map((item) => ({
        id: item.id,
        festival: item.resourceKey,
        field: item.field,
        current: JSON.stringify(item.beforeValue),
        detected: JSON.stringify(item.afterValue),
        source: JSON.stringify(item.sourceEvidence),
        confidence: item.confidence ?? 0,
        status: item.status.toLowerCase() as "pending" | "approved" | "rejected",
        conflict: item.status === "CONFLICT",
      }))}
      parserRuns={snapshot.runs.map((item) => ({
        festival: item.festivalSlug,
        source: item.adapter,
        status:
          item.status === "SUCCEEDED"
            ? "healthy"
            : item.status === "FAILED"
              ? "failed"
              : item.status === "RUNNING"
                ? "running"
                : "warning",
        lastRun: item.startedAt.toISOString(),
        durationMs: item.durationMs ?? 0,
        extracted: item.extracted,
        message: item.message,
        log: item.log,
      }))}
      auditEntries={snapshot.audit.map((item) => ({
        id: item.id,
        at: item.createdAt.toISOString(),
        actor: item.actorLabel,
        action: item.action,
        target: item.resourceKey ?? "system",
        detail: JSON.stringify(item.metadata ?? {}),
      }))}
    />
  );
}
