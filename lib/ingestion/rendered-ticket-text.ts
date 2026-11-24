import type { Cheerio } from "cheerio";
import type { AnyNode } from "domhandler";

const blocks =
  "address, article, aside, blockquote, div, dl, dt, dd, fieldset, figure, " +
  "figcaption, h1, h2, h3, h4, h5, h6, hr, li, main, ol, p, pre, section, " +
  "table, td, th, tr, ul";
const blockDisplay = /^(?:block|flex|grid|table|flow-root|list-item|table-cell|table-row)$/i;

/** Read visible stock prose without joining adjacent blocks or splitting inline words. */
export function renderedTicketText(scope: Cheerio<AnyNode>): string {
  const copy = scope.clone();
  copy.find(blocks + ", br, [style]").each((_, element) => {
    const box = copy.find(element);
    const display = box
      .css("display")
      ?.replace(/\s*!important\s*$/i, "")
      .trim();
    if (box.is("br") || (display ? blockDisplay.test(display) : box.is(blocks))) {
      box.before(" ").after(" ");
    }
  });
  return copy.text().replace(/\s+/g, " ").trim();
}
