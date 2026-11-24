"use client";

import Link from "next/link";
import { useLanguage } from "./LanguageProvider";
import { projectRepository, siteInformation, type InformationPage } from "@/lib/site-information";

export function SiteInformation({ page }: { page: InformationPage }) {
  const { language: lang } = useLanguage();
  const info = siteInformation[lang];
  if (page === "about") {
    return (
      <article className="siteInformation" lang={lang}>
        <h1>{info.about}</h1>
        <p>{info.aboutDescription}</p>
        <p>{info.independence}</p>
        <Link href={`/${lang}/faq/`}>{info.faq}</Link>
      </article>
    );
  }
  return (
    <article className="siteInformation" lang={lang}>
      <h1>{info.faq}</h1>
      {info.topics.map(({ question, text, action }) => (
        <details key={question}>
          <summary>{question}</summary>
          <p>{text}</p>
          {action &&
            (action.path === "/issues/new" ? (
              <a href={projectRepository + action.path}>{action.label}</a>
            ) : (
              <Link href={`/${lang}${action.path}`}>{action.label}</Link>
            ))}
        </details>
      ))}
      <Link href={`/${lang}/about/`}>{info.about}</Link>
    </article>
  );
}
