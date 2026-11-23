"use client";

import Link from "next/link";
import { useState, type FormEvent } from "react";
import type { SubmissionEditionLink as LinkedEdition } from "@/lib/submission-edition-link";
import { SubmissionFollowOnEdition, type FollowOnDraft } from "./SubmissionFollowOnEdition";
import { useLanguage } from "./LanguageProvider";

const labels = {
  en: { select: "Existing edition", link: "Link existing edition", linked: "Linked edition", choose: "Choose an edition",
    missing: "No matching-year edition in the catalogue. Approval does not publish a festival.",
    failed: "Could not link this edition. Check the official site and edition year." },
  de: { select: "Vorhandene Ausgabe", link: "Vorhandene Ausgabe verknüpfen", linked: "Verknüpfte Ausgabe", choose: "Ausgabe auswählen",
    missing: "Für dieses Jahr gibt es keine Ausgabe im Katalog. Die Freigabe veröffentlicht kein Festival.",
    failed: "Die Ausgabe konnte nicht verknüpft werden. Prüfe die offizielle Website und das Jahr." },
  ru: { select: "Существующий выпуск", link: "Связать с существующим выпуском", linked: "Связанный выпуск", choose: "Выберите выпуск",
    missing: "В каталоге нет выпуска за этот год. Одобрение не публикует фестиваль.",
    failed: "Не удалось связать выпуск. Проверьте официальный сайт и год проведения." },
};

export function SubmissionEditionLink({ reference, year, editions, currentEditions, initialLink, initialDraft }: {
  reference: string;
  year: number;
  editions: { slug: string; name: string; year: number }[];
  currentEditions: { slug: string; name: string; year: number }[];
  initialLink?: LinkedEdition | null;
  initialDraft?: FollowOnDraft;
}) {
  const { language } = useLanguage();
  const copy = labels[language];
  const [link, setLink] = useState(initialLink);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const options = editions.filter(edition => edition.year === year);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const slug = new FormData(event.currentTarget).get("slug");
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch(`/api/admin/submissions/${reference}/edition`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ slug }),
      });
      if (!response.ok) throw new Error("Edition link failed");
      setLink(await response.json());
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  if (link) return <p>{copy.linked}: <Link href={`/festivals/${link.slug}/${link.year}/`}>{link.slug} · {link.year}</Link></p>;
  return <>
    {!options.length ? <p>{copy.missing}</p> : <form onSubmit={submit}>
    <label>{copy.select}
      <select name="slug" defaultValue="" required>
        <option value="" disabled>{copy.choose}</option>
        {options.map(edition => <option key={edition.slug} value={edition.slug}>{edition.name} · {edition.year}</option>)}
      </select>
    </label>
    <button type="submit" disabled={busy}>{copy.link}</button>
    {failed && <p role="alert">{copy.failed}</p>}
    </form>}
    <SubmissionFollowOnEdition reference={reference} year={year} options={currentEditions} initialDraft={initialDraft} onLink={setLink} />
  </>;
}
