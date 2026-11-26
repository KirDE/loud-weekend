import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { transform } from "esbuild";
import { renderToStaticMarkup } from "react-dom/server";
import { extractHellfestOfferProposals } from "../lib/ingestion/adapters/hellfest-offers.ts";
import {
  loadTicketOfferReview,
  submitTicketOfferReview,
} from "../lib/ticket-offer-review-client.ts";
import { FestivalTicketOffers } from "../components/FestivalTicketOffers.tsx";
const require = createRequire(import.meta.url);
const fixture = await readFile(
  new URL("./fixtures/hellfest/offer-cards.html", import.meta.url),
  "utf8",
);
function snapshot() {
  const proposal = extractHellfestOfferProposals({
    html: fixture,
    editionYear: 2027,
    finalUrl: "https://hellfest.fr/",
    status: 200,
    observedAt: new Date().toISOString(),
  });
  assert.equal(proposal.warnings.length, 0);
  return { id: "snapshot/test", contentHash: "a".repeat(64), reviewState: "pending", proposal };
}
function reply(body, status = 200) {
  return Response.json(body, { status });
}
const source = await readFile(
  new URL("../components/TicketOfferReviewQueue.tsx", import.meta.url),
  "utf8",
);
const { code } = await transform(source, {
  loader: "tsx",
  jsx: "automatic",
  format: "cjs",
  target: "es2022",
});
function harness(fetcher, locale = "en") {
  const slots = [];
  let cursor = 0;
  const deps = {
    react: {
      useState(initial) {
        const i = cursor++;
        if (!(i in slots)) slots[i] = initial;
        return [
          slots[i],
          (v) => {
            slots[i] = v;
          },
        ];
      },
      useRef(initial) {
        const i = cursor++;
        return (slots[i] ??= { current: initial });
      },
      useEffect() {},
    },
    "react/jsx-runtime": require("react/jsx-runtime"),
    "../lib/ticket-offer-review-client": {
      loadTicketOfferReview: (id, signal) => loadTicketOfferReview(id, signal, fetcher),
      submitTicketOfferReview: (s, d, signal) => submitTicketOfferReview(s, d, signal, fetcher),
    },
    "./FestivalTicketOffers": { FestivalTicketOffers },
  };
  const module = { exports: {} };
  new Function("require", "module", "exports", code)(
    (id) => {
      assert.ok(Object.hasOwn(deps, id), id);
      return deps[id];
    },
    module,
    module.exports,
  );
  const render = () => {
    cursor = 0;
    return module.exports.TicketOfferReviewQueue({ editionId: "edition/test", year: 2027, locale });
  };
  const buttons = (tree) => {
    if (!tree || typeof tree !== "object") return [];
    if (Array.isArray(tree)) return tree.flatMap(buttons);
    return [...(tree.type === "button" ? [tree] : []), ...buttons(tree.props?.children)];
  };
  return { render, buttons };
}
for (const locale of ["en", "de", "ru"])
  test(`actual queue loads revision/evidence, then approves and rereads in ${locale}`, async () => {
    const value = snapshot();
    const calls = [];
    const h = harness(async (url, options) => {
      calls.push({ url, options });
      if (options.method === "POST") {
        value.reviewState = "approved";
        return reply({ snapshotId: value.id, decision: "approve" });
      }
      return reply(value);
    }, locale);
    await h.buttons(h.render())[0].props.onClick();
    const loaded = h.render();
    const html = renderToStaticMarkup(loaded);
    assert.match(html, /389/);
    assert.match(html, /hellfest.fr/);
    assert.match(html, /aaaaaaaa/);
    assert.equal(h.buttons(loaded).length, 3);
    await h.buttons(loaded)[2].props.onClick();
    assert.equal(h.buttons(h.render()).length, 1);
    assert.deepEqual(JSON.parse(calls[1].options.body), {
      decision: "approve",
      expectedContentHash: value.contentHash,
    });
    assert.match(calls[0].url, /edition%2Ftest$/);
    assert.match(calls[1].url, /snapshot%2Ftest$/);
    assert.equal(calls.length, 3);
    assert.equal(calls[0].options.cache, "no-store");
  });
test("queue clears stale actions on conflict, invalid data, denial or unconfirmed decision", async () => {
  for (const failure of [
    reply({ error: "Conflict" }, 409),
    reply({ error: "Forbidden" }, 403),
    reply({ snapshotId: "other", decision: "approve" }),
    new Response("<html>challenge</html>"),
  ]) {
    const value = snapshot();
    let count = 0;
    const h = harness(async () => (++count === 1 ? reply(value) : failure));
    await h.buttons(h.render())[0].props.onClick();
    await h.buttons(h.render())[2].props.onClick();
    assert.equal(h.buttons(h.render()).length, 1);
    assert.match(renderToStaticMarkup(h.render()), /Could not confirm/);
    assert.doesNotMatch(renderToStaticMarkup(h.render()), /aaaaaaaa/);
  }
});
test("actual queue rejects foreign edition, corrupt schema and expired proposals for decisions", async () => {
  for (const change of [
    (s) => {
      s.proposal.editionYear = 2026;
    },
    (s) => {
      s.contentHash = "bad";
    },
    (s) => {
      s.proposal.sourceUrl = "https://foreign.invalid/";
    },
  ]) {
    const value = snapshot();
    change(value);
    const h = harness(async () => reply(value));
    await h.buttons(h.render())[0].props.onClick();
    assert.equal(h.buttons(h.render()).length, 1);
    assert.match(renderToStaticMarkup(h.render()), /Could not confirm/);
  }
  const value = snapshot();
  value.proposal.observedAt = new Date(Date.now() - 86_500_000).toISOString();
  for (const offer of value.proposal.offers) offer.observedAt = value.proposal.observedAt;
  const h = harness(async () => reply(value));
  await h.buttons(h.render())[0].props.onClick();
  assert.ok(
    h
      .buttons(h.render())
      .slice(1)
      .every((b) => b.props.disabled),
  );
});
test("missing proposals differ from failures and repeat clicks do not decide twice", async () => {
  const empty = harness(async () => reply({ error: "No tier proposal" }, 404));
  await empty.buttons(empty.render())[0].props.onClick();
  assert.match(renderToStaticMarkup(empty.render()), /No proposal collected/);
  let resolve;
  let calls = 0;
  const h = harness(async () => {
    calls++;
    return new Promise((r) => {
      resolve = r;
    });
  });
  const button = h.buttons(h.render())[0];
  const first = button.props.onClick();
  await button.props.onClick();
  assert.equal(calls, 1);
  resolve(reply(snapshot()));
  await first;
});
