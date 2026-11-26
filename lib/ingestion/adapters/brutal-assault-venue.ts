import { load } from "cheerio";

export const brutalAssaultVenueSource = {
  festivalSlug: "brutal-assault",
  countryCode: "CZ",
  organizerHost: "brutalassault.cz",
  sourceUrl: "https://brutalassault.cz/en/about-brutal",
};

const text = (copy: string) => copy.replace(/\s+/g, " ").trim();
const dms = "(\\d{1,3})°\\s*(\\d{1,2})[′']\\s*(\\d{1,2}(?:\\.\\d+)?)[″\"]";
const coordinates = new RegExp(`^GPS location:\\s*${dms}([NS])\\s+${dms}([EW])$`, "i");

function decimal(degrees: string, minutes: string, seconds: string, hemisphere: string) {
  if (+minutes >= 60 || +seconds >= 60) return NaN;
  return (+degrees + +minutes / 60 + +seconds / 3600) * (/[SW]/i.test(hemisphere) ? -1 : 1);
}

/** Parse only the visible edition-bound Date and Place block, not map embeds. */
export function parseBrutalAssaultVenue(html: string, editionYear: number) {
  const $ = load(html);
  $(
    "script,style,noscript,template,.hidden,.d-none,[hidden],[inert],[aria-hidden='true']",
  ).remove();
  $("[style]").each((_, element) => {
    if (/display\s*:\s*none|visibility\s*:\s*hidden/i.test($(element).attr("style") ?? ""))
      $(element).remove();
  });
  const headings = $("nav > h1").filter(
    (_, heading) => text($(heading).text()) === "Date and Place",
  );
  if (headings.length !== 1) return;
  const block = headings.parent();
  const dates = block
    .children("b")
    .first()
    .text()
    .match(/^\s*[A-Za-z]+ \d{1,2}\s*[-–]\s*\d{1,2},\s*(20\d{2})\b/);
  if (Number(dates?.[1]) !== editionYear) return;

  const place = text(block.children("b").eq(1).contents().first().text()).match(
    /^(.+?)\s+[-–]\s+(.+)$/,
  );
  block.find("br").replaceWith("\n");
  const gps = block
    .text()
    .split("\n")
    .map(text)
    .filter((line) => /^GPS location:/i.test(line));
  const coordinate = gps.length === 1 && gps[0].match(coordinates);
  if (!place || !coordinate) return;
  const [, degN, minN, secN, ns, degE, minE, secE, ew] = coordinate;
  const latitude = decimal(degN, minN, secN, ns);
  const longitude = decimal(degE, minE, secE, ew);
  if (!(Math.abs(latitude) <= 85.051129 && Math.abs(longitude) <= 180)) return;
  const [, city, name] = place;
  return { city, name, latitude, longitude };
}
