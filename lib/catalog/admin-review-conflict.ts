// Only throw for a stale canonical precondition, before any publication writes.
export class CanonicalReviewConflict extends Error {}
