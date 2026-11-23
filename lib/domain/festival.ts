// Catalogue shapes are independent of the live, repository-backed seed data.
export type TimetableEntry = {
  date: string;
  stage: string;
  start: string;
  artist: string;
  timeZone: string;
  status: "scheduled" | "cancelled";
  sourceUrl: string;
  observedAt: string;
};

export type Festival = {
  slug: string;
  name: string;
  country: string;
  countryCode: string;
  city?: string;
  startDate?: string;
  endDate?: string;
  dateLabel?: string;
  headliners: string[];
  lineup: string[];
  officialUrl: string;
  ticketsUrl?: string;
  playlistUrl?: string;
  reviewedPlaylistLinks?: { spotify?: string; youtube_music?: string };
  sourceDeprecated?: boolean;
  sourceDeprecatedAt?: string;
  status: "confirmed" | "partial" | "tba";
  editionYear?: number;
  completeness?: "complete" | "partial" | "tba";
  ticketStatus:
    "available" | "low" | "not_on_sale" | "sold_out" | "sales_ended" | "unavailable" | "unknown";
  updatedAt: string;
  genres: string[];
  coordinates?: { latitude: number; longitude: number };
  timetable?: TimetableEntry[];
};

export type PlaylistStatus = {
  spotifyUrl: string;
  youtubeMusicUrl?: string;
  youtubeMusicArtists?: number;
  youtubeMusicTracks?: number;
  artists: number;
  tracks: number;
  updatedAt: string;
};
