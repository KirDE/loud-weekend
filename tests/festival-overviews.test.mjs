import assert from "node:assert/strict";
import test from "node:test";
import { editorialOverviews, festivalOverview } from "../lib/catalog/festival-overviews.ts";

test("editorial overviews use localized copy and public official sources on the matching edition", () => {
  assert.equal(editorialOverviews.length, 3);
  for (const entry of editorialOverviews) {
    const festival = { slug: entry.slug, editionYear: entry.year, city: entry.place };
    assert.equal(festivalOverview(festival), entry);
    assert.equal(festivalOverview({ ...festival, editionYear: 2026 }), undefined);
    assert.equal(festivalOverview({ ...festival, editionYear: undefined }), undefined);
    assert.equal(festivalOverview({ ...festival, city: "Other city" }), undefined);
    assert.deepEqual(Object.keys(entry.summary).sort(), ["de", "en", "ru"]);
    assert.equal(new Set(Object.values(entry.summary)).size, 3);
    assert.equal(new Date(entry.checkedOn).toISOString().slice(0, 10), entry.checkedOn);
    for (const source of entry.sources) {
      const url = new URL(source);
      assert.equal(url.protocol, "https:");
      assert.ok(!url.username && !url.password && !url.search && !url.hash);
    }
  }
  assert.equal(festivalOverview({ slug: "unknown", editionYear: 2027, city: "Wacken" }), undefined);
});
