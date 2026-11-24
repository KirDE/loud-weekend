import { lifecycleReviewSchema, type LifecycleReview } from "./domain/edition-lifecycle-review";

/** Same-origin reviewer API only. Never send an actor, proposal, or source override. */
export async function loadLifecycleReview(
  editionId: string,
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<LifecycleReview | null> {
  const response = await fetcher(
    `/api/admin/edition-lifecycle/editions/${encodeURIComponent(editionId)}`,
    { cache: "no-store", signal, headers: { accept: "application/json" } },
  );
  const body = await response.json();
  if (response.status === 404 && body?.error === "No lifecycle proposal") return null;
  if (!response.ok) throw new Error("Lifecycle review unavailable");
  return lifecycleReviewSchema.parse(body);
}

export async function submitLifecycleReview(
  snapshot: LifecycleReview,
  decision: "approve" | "reject",
  signal: AbortSignal,
  fetcher: typeof fetch = fetch,
): Promise<void> {
  if (
    snapshot.reviewState !== "pending" ||
    !snapshot.eligibleForReview ||
    !["approve", "reject"].includes(decision)
  )
    throw new Error("Ineligible lifecycle decision");
  const age = Date.now() - Date.parse(snapshot.proposal.observedAt);
  if (age > 86_400_000 || age < -60_000) throw new Error("Expired lifecycle decision");
  const response = await fetcher(
    `/api/admin/edition-lifecycle/snapshots/${encodeURIComponent(snapshot.id)}`,
    {
      method: "POST",
      signal,
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ decision, expectedContentHash: snapshot.contentHash }),
    },
  );
  const body = await response.json();
  if (!response.ok || body?.snapshotId !== snapshot.id || body?.decision !== decision)
    throw new Error("Lifecycle decision not confirmed");
}
