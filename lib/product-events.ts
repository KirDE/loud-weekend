import { privacySignalEnabled } from "./privacy-analytics.mjs";

export const PRODUCT_EVENT_TYPE = "application/vnd.loud-weekend.event+json";
export const productEventNames = [
  "SEARCH_SUBMIT",
  "FILTER_USED",
  "COMPARE",
  "SAVE",
  "TICKET_OUTBOUND",
  "PLAYLIST_START",
  "PLAYLIST_SUCCESS",
  "NOTIFICATIONS_OPT_IN",
] as const;

export function sendProductEvent(
  event: (typeof productEventNames)[number],
  locale: "en" | "de" | "ru",
) {
  if (process.env.NEXT_PUBLIC_PRODUCT_EVENTS_ENABLED !== "true" || privacySignalEnabled(navigator))
    return;
  const endpoint = (process.env.NEXT_PUBLIC_BASE_PATH ?? "") + "/api/analytics/page-view/";
  void fetch(endpoint, {
    method: "POST",
    headers: { "content-type": PRODUCT_EVENT_TYPE },
    body: JSON.stringify({ event, locale }),
    mode: "same-origin",
    credentials: "omit",
    referrerPolicy: "no-referrer",
    redirect: "error",
    keepalive: true,
  }).catch(() => {});
}
