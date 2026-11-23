import { DataQualityContent } from "@/components/DataQualityContent";
import { dataQualityCopy } from "@/lib/data-quality-copy";
import { notFound } from "next/navigation";
import { summarizeDataQuality } from "@/lib/catalog/data-quality";
import { getCatalog } from "@/lib/catalog/repository";
import { supportedLanguages, type SupportedLanguage } from "@/lib/catalog/public";

export const dynamic = "force-dynamic";
type Params = Promise<{ lang: string }>;

function language(value: string): SupportedLanguage {
  if (!supportedLanguages.some((lang) => lang === value)) notFound();
  return value as SupportedLanguage;
}

export async function generateMetadata({ params }: { params: Params }) {
  const lang = language((await params).lang);
  return {
    title: dataQualityCopy[lang].title,
    alternates: {
      canonical: `/${lang}/data-quality/`,
      languages: Object.fromEntries(
        supportedLanguages.map((key) => [key, `/${key}/data-quality/`]),
      ),
    },
  };
}

async function readQuality() {
  try {
    return summarizeDataQuality(await getCatalog({ includeFreshness: true }));
  } catch {
    // Do not serialize connection diagnostics or source failures into the page.
    return undefined;
  }
}

export default async function DataQualityPage({ params }: { params: Params }) {
  language((await params).lang);
  return <DataQualityContent data={await readQuality()} />;
}
