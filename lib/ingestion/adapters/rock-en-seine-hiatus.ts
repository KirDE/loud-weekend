import { load } from "cheerio";

export const ROCK_EN_SEINE_HOME = "https://www.rockenseine.com/";
/** Review-only lifecycle evidence, intentionally NOT a FestivalCandidate.
 * A festival hiatus is neither ticket sellout nor a future on-sale date.
 * No runner/catalog registration until durable reviewed lifecycle is supported.
 */
export type RockEnSeineHiatusProposal = {
  festivalSlug: "rock-en-seine";
  editionYear: number;
  lifecycle: "hiatus";
  announcedReturnYear: number;
  alternativeEvent: "under_consideration";
  sourceUrl: typeof ROCK_EN_SEINE_HOME;
  observedAt: string;
  excerpt: string;
};
const heading = /^Le festival revient en (20\d{2}|21\d{2}|2200)$/;
const pause = /^C’est pourquoi nous faisons le choix difficile de faire une pause en (20\d{2}|21\d{2}) pour mieux se retrouver en (20\d{2}|21\d{2}|2200)\.$/;
const alternative = /^Mais comme on n’a pas l’intention de passer toute une année sans vous, on réfléchit à la possibilité de proposer en (20\d{2}|21\d{2}) un rendez-vous différent pour continuer à faire vivre l’esprit Rock en Seine ensemble\.$/;
const hiatusExcerpt = (paused: number, returning: number) =>
  `Rock en Seine: festival pauses in ${paused} and announces a return in ${returning}. A different ${paused} event is only under consideration, not confirmed. No ordinary ${paused} ticket inventory assertion.`;
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
  if (group.length !== 1 || group.children("h2").length !== 1) fail();
  const headlineYear = Number(clean(group.children("h2").text()).match(heading)?.[1]);
  const paragraphs = group.children("p").toArray().map(el => clean($(el).text()));
  const pauses = paragraphs.map(text => text.match(pause)).filter(match => match !== null);
  const alternatives = paragraphs.map(text => text.match(alternative)).filter(match => match !== null);
  const editionYear = Number(pauses[0]?.[1]);
  const announcedReturnYear = Number(pauses[0]?.[2]);
  const contradiction = new RegExp(`(?:billets? en vente|tickets? on sale|édition ${editionYear} (?:aura lieu|confirmée))`, "i");
  if (pauses.length !== 1 || alternatives.length !== 1 || Number(alternatives[0]?.[1]) !== editionYear
    || announcedReturnYear !== headlineYear || announcedReturnYear !== editionYear + 1
    || paragraphs.some(text => contradiction.test(text))) fail();
  return {
    festivalSlug: "rock-en-seine", editionYear, lifecycle: "hiatus", announcedReturnYear,
    alternativeEvent: "under_consideration", sourceUrl: ROCK_EN_SEINE_HOME, observedAt,
    excerpt: hiatusExcerpt(editionYear, announcedReturnYear),
  };
}
