export type PlaylistStage = 'setup' | 'spotify_discovery' | 'spotify_apply' | 'spotify_checkpoint' | 'youtube_discovery' | 'youtube_apply' | 'commit';
export const youtubeHoldReasons = ['youtube_create_unknown_no_resend', 'youtube_insert_unknown_no_resend',
  'youtube_metadata_unknown_no_resend', 'youtube_existing_identity_ambiguous',
  'youtube_owner_ambiguous', 'youtube_invalid_created_id', 'youtube_creation_metadata_failed'];
const reasons = [...youtubeHoldReasons, 'spotify_readback_mismatch', 'spotify_plan_superseded', 'playlist_rpc_failed', 'youtube_quota_bound_reached', 'youtube_reconciliation_required', 'youtube_provider_quota_exceeded', 'youtube_provider_rejected_403_quotaExceeded', 'youtube_insert_readback_failed', 'youtube_metadata_readback_failed', 'youtube_delete_readback_failed', 'unclassified'];
const diagnostic = new RegExp(`^playlist_worker_failed stage=(setup|spotify_discovery|spotify_apply|spotify_checkpoint|youtube_discovery|youtube_apply|commit) reason=(${reasons.join('|')})$`);

/** Closed vocabulary: provider messages, URLs, bodies and secrets stay private. */
export function playlistFailure(stage: PlaylistStage, error: unknown): string {
  const failure = error as { stderr?: unknown; message?: unknown } | null;
  const lines = typeof failure?.stderr === 'string' ? failure.stderr.split('\n') : [];
  const reason = failure?.message === 'Spotify plan superseded' ? 'spotify_plan_superseded' : lines.findLast(line => youtubeHoldReasons.includes(line)) ?? lines.findLast(line => reasons.includes(line)) ?? 'unclassified';
  return `playlist_worker_failed stage=${stage} reason=${reason}`;
}

export function dispatchedPlaylistFailure(error: unknown): string {
  const stderr = (error as { stderr?: unknown } | null)?.stderr;
  return (typeof stderr === 'string' ? stderr.split('\n').find(line => diagnostic.test(line)) : undefined) ?? 'playlist_dispatch_failed';
}
