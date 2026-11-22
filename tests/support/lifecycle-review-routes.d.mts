type Actor = { id: string; email: string; role: string };
type Handler = (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response>;
export function loadReviewRoute(kind: 'editions' | 'snapshots', dependencies: Record<string, unknown>): Promise<{ GET: Handler; POST: Handler }>;
export function loadCurrentAdmin(currentUser: () => Promise<Actor | null>): Promise<() => Promise<Actor | null>>;
