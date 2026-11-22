"use client";

import type { Festival } from "@/lib/domain/festival";
import { editionOnHiatus } from "@/lib/edition-lifecycle";
import { useLanguage } from "./LanguageProvider";

/** Only the approved, minimal public projection enters this component. */
export function EditionLifecycleNotice({ item }: { item: Pick<Festival, "slug" | "editionYear" | "officialUrl" | "editionLifecycle"> }) {
  const { locale, t } = useLanguage();
  if (!editionOnHiatus(item)) return null;
  const notice = item.editionLifecycle!;
  const observed = new Intl.DateTimeFormat(locale, {
    year: "numeric", month: "short", day: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit",
    timeZone: "UTC", timeZoneName: "short",
  }).format(new Date(notice.observedAt));
  return <section className="sourceNote" aria-label={t("editionHiatus")}>
    <strong>{t("editionHiatus")} · {notice.editionYear}</strong>
    <p>{t("editionHiatusExplanation")}</p>
    {notice.announcedReturnYear !== null && <p>{t("editionReturn")}: {notice.announcedReturnYear}</p>}
    {notice.alternativeEvent === "under_consideration" && <p>{t("editionAlternative")}</p>}
    <p>{t("lifecycleObserved")}: <time dateTime={notice.observedAt}>{observed}</time></p>
    <a href={notice.sourceUrl} target="_blank" rel="noreferrer">{t("primarySource")}</a>
  </section>;
}
