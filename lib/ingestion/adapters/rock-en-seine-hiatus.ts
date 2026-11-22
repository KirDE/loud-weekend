import { load } from "cheerio";

export const ROCK_EN_SEINE_HOME = "https://www.rockenseine.com/";
/** Review-only lifecycle evidence, intentionally NOT a FestivalCandidate.
 * A festival hiatus is neither ticket sellout nor a future on-sale date.
 * No runner/catalog registration until durable reviewed lifecycle is supported.
 */
export type RockEnSeineHiatusProposal = {
  festivalSlug: "rock-en-seine";
  editionYear: 2027;
  lifecycle: "hiatus";
  announcedReturnYear: 2028;
  alternativeEvent: "under_consideration";
  sourceUrl: typeof ROCK_EN_SEINE_HOME;
  observedAt: string;
  excerpt: string;
};
const heading = "Le festival revient en 2028";
const pause = "C’est pourquoi nous faisons le choix difficile de faire une pause en 2027 pour mieux se retrouver en 2028.";
const alternative = "Mais comme on n’a pas l’intention de passer toute une année sans vous, on réfléchit à la possibilité de proposer en 2027 un rendez-vous différent pour continuer à faire vivre l’esprit Rock en Seine ensemble.";
const clean = (v: string) => v.replace(/\s+/gu, " ").trim();
const fail = (): never => { throw new Error("Rock en Seine edition hiatus not verified"); };
export function observeRockEnSeineHiatus(
  html: string, observedAt: string,
  transport: { status: number; finalUrl: string },
): RockEnSeineHiatusProposal {
  if (transport.status !== 200 || transport.finalUrl !== ROCK_EN_SEINE_HOME
    || !Number.isFinite(Date.parse(observedAt)) || new Date(observedAt).toISOString() !== observedAt
    || !html || Buffer.byteLength(html, "utf8") > 2_000_000) fail();
  const $ = load(html);
  if ($("title").length !== 1 || !/Rock en Seine/i.test($("title").text())) fail();
  $("script, style, template, noscript, [inert], [hidden], [aria-hidden='true'], .hidden, .d-none, .u-hidden").remove();
  $("[style]").each((_, el) => {
    if (/(?:display\s*:\s*none|visibility\s*:\s*(?:hidden|collapse)|opacity\s*:\s*0(?:\s*[;!]|$))/i.test($(el).attr("style") ?? "")) $(el).remove();
  });
  const section = $("section#artistes");
  if (section.length !== 1) fail();
  const group = section.children("div.container-md.t-balance.cn-block-group");
  if (group.length !== 1 || group.children("h2").length !== 1 || clean(group.children("h2").text()) !== heading) fail();
  const paragraphs = group.children("p").toArray().map(el => clean($(el).text()));
  if (paragraphs.filter(p => p === pause).length !== 1 || paragraphs.filter(p => p === alternative).length !== 1
    || paragraphs.some(p => /(?:billets? en vente|tickets? on sale|édition 2027 (?:aura lieu|confirmée))/i.test(p))) fail();
  return {
    festivalSlug: "rock-en-seine", editionYear: 2027, lifecycle: "hiatus", announcedReturnYear: 2028,
    alternativeEvent: "under_consideration", sourceUrl: ROCK_EN_SEINE_HOME, observedAt,
    // Fixed minimized assertion; never copy arbitrary page/legal/contact text.
    excerpt: "Rock en Seine: festival pauses in 2027 and announces a return in 2028. A different 2027 event is only under consideration, not confirmed. No ordinary 2027 ticket inventory assertion.",
  };
}
