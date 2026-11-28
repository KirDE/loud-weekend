"use client";

import type { PlaylistRefreshFailures } from "@/lib/catalog/playlist-refresh-readback";
import type { Festival, PlaylistStatus } from "@/lib/domain/festival";
import { useLanguage } from "./LanguageProvider";
import { PlaylistCoverageLabel } from "./PlaylistCoverageLabel";

export function FestivalPlaylistActions({
  item,
  playlist,
  playlistRefreshFailures,
  showPlaceholder = false,
  standalone = false,
}: {
  item: Pick<Festival, "reviewedPlaylistLinks" | "playlistUrl">;
  playlist?: PlaylistStatus;
  playlistRefreshFailures?: PlaylistRefreshFailures;
  showPlaceholder?: boolean;
  standalone?: boolean;
}) {
  const { t } = useLanguage();
  const providers = [
    {
      key: "spotify",
      title: "spotifyPlaylist",
      href: item.reviewedPlaylistLinks?.spotify || playlist?.spotifyUrl || item.playlistUrl,
      managedUrl: playlist?.spotifyUrl,
      placeholder: showPlaceholder,
    },
    {
      key: "youtubeMusic",
      title: "youtubeMusicPlaylist",
      href: item.reviewedPlaylistLinks?.youtube_music || playlist?.youtubeMusicUrl,
      managedUrl: playlist?.youtubeMusicUrl,
      placeholder: false,
    },
  ] as const;
  const actions = providers.flatMap(({ key, title, href, managedUrl, placeholder }) => {
    const failed = playlistRefreshFailures?.[key];
    if (href) {
      return [
        <a key={key} href={href} target="_blank" rel="noreferrer">
          <small>{t("listen")}</small>
          <strong>{t(title)}</strong>
          <PlaylistCoverageLabel
            coverage={href === managedUrl ? playlist?.coverage?.[key] : undefined}
            failed={failed}
          />
        </a>,
      ];
    }
    if (!failed && !placeholder) return [];
    return [
      <div key={key} className="disabled">
        <small>{t("listen")}</small>
        <strong>{t(failed ? title : "playlistSoon")}</strong>
        {failed && <PlaylistCoverageLabel failed />}
      </div>,
    ];
  });
  if (!actions.length) return null;
  return standalone ? <div className="actionGrid">{actions}</div> : <>{actions}</>;
}
