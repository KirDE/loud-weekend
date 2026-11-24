export const playlistDepths = ["quick", "preview", "deep"] as const;
export type PlaylistDepth = (typeof playlistDepths)[number];
