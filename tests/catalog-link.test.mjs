import assert from "node:assert/strict";
import test from "node:test";
import NextLink from "next/link.js";
import CatalogLink from "../components/CatalogLink.tsx";

test("exact edition links use native document navigation with their URL and anchor semantics intact", () => {
  const onClick = () => {};
  for (const prefix of ["", "/en", "/de", "/ru"]) {
    for (const year of [2026, 2027, 2028]) {
      const href = `${prefix}/festivals/synthetic/${year}/`;
      const result = CatalogLink({
        href,
        prefetch: false,
        onClick,
        target: "_blank",
        rel: "noreferrer",
      });
      assert.equal(result.type, "a");
      assert.equal(result.props.href, href);
      assert.equal(result.props.onClick, onClick);
      assert.equal(result.props.target, "_blank");
      assert.equal(result.props.rel, "noreferrer");
      assert.equal("prefetch" in result.props, false);
    }
  }
});

test("series, unknown-year, artists, planner and other existing links retain Next navigation", () => {
  for (const href of [
    "/festivals/synthetic/",
    "/festivals/synthetic/undefined/",
    "/artists/synthetic/",
    "/planner/",
    "/en/editions/2027/",
  ]) {
    const result = CatalogLink({ href, prefetch: false, children: "Open" });
    assert.equal(result.type, NextLink);
    assert.equal(result.props.href, href);
    assert.equal(result.props.prefetch, false);
    assert.equal(result.props.children, "Open");
  }
});
