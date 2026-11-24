import assert from "node:assert/strict";
import test from "node:test";
import { showOfflineCatalog } from "../public/offline-trips.mjs";

async function render(fetchImpl, base = "/", language = "en") {
  const element = (tag) => ({
    tag,
    textContent: "",
    children: [],
    append(...children) {
      this.children.push(...children);
    },
    replaceChildren(...children) {
      this.children = children;
    },
    set innerHTML(_) {
      throw new Error("Public names must be rendered as text");
    },
  });
  const status = element("p");
  const catalog = element("section");
  const document = {
    getElementById: (id) => (id === "catalog-status" ? status : catalog),
    createElement: element,
    createDocumentFragment: () => element("fragment"),
  };
  await showOfflineCatalog(document, fetchImpl, base, language);
  return { status, catalog };
}

test(
  "offline page consumes public DB JSON and displays dates, tim" +
    "etable, cancellations and missing data as text",
  async () => {
    const { status, catalog } = await render(async (url, options) => {
      assert.equal(url, "/api/offline/catalog/");
      assert.equal(options.credentials, "omit");
      return new Response(
        JSON.stringify({
          schemaVersion: 1,
          festivals: [
            {
              name: "<img src=x onerror=alert(1)>",
              startDate: "2027-06-01",
              endDate: "2027-06-02",
              timetable: [
                {
                  date: "2027-06-01",
                  start: "18:00",
                  timeZone: "Europe/Berlin",
                  stage: "Main",
                  artist: "<b>Artist</b>",
                  status: "cancelled",
                },
              ],
            },
            { name: "Unannounced", startDate: null, endDate: null, timetable: [] },
          ],
        }),
      );
    });
    const children = catalog.children[0].children;
    assert.equal(children[0].textContent, "<img src=x onerror=alert(1)>");
    assert.equal(children[1].textContent, "2027-06-01 – 2027-06-02");
    assert.equal(
      children[2].children[0].textContent,
      "2027-06-01 · 18:00 (Europe/Berlin) · Main · <b>Artist</b> · Cancelled",
    );
    assert.equal(children[4].textContent, "Dates not published");
    assert.equal(children[5].textContent, "Timetable not published");
    assert.match(status.textContent, /Saved public/);
  },
);

test("offline page does not substitute data when the catalogue is missing or invalid", async () => {
  for (const fetchImpl of [
    async () => {
      throw new TypeError("offline");
    },
    async () => new Response(null, { status: 503 }),
    async () => new Response("not JSON"),
    async () => new Response('{"schemaVersion":1,"festivals":[]}'),
  ]) {
    const { status, catalog } = await render(fetchImpl);
    assert.match(status.textContent, /No saved festival data/);
    assert.equal(catalog.children.length, 0);
  }
});

test("catalogue requests stay under the installation path and empty data is localized", async () => {
  const { status } = await render(
    async (url) => {
      assert.equal(url, "/radar/api/offline/catalog/");
      return new Response(null, { status: 503 });
    },
    "/radar/",
    "ru",
  );
  assert.match(status.textContent, /^Нет сохранённых данных фестивалей/);
});
