import postcss from "postcss";

export function shellLogicalLines(source) {
  return source.replace(/'\\\n'/g, "").replace(/[ \t]*\\\n[ \t]*/g, " ");
}

export function cssDeclarations(source, selector, media = "root") {
  const result = {};
  postcss.parse(source).walkRules((rule) => {
    if ((rule.parent.params ?? "root") !== media) return;
    if (
      rule.selector
        .split(",")
        .map((part) => part.trim())
        .includes(selector)
    ) {
      rule.walkDecls((decl) => {
        result[decl.prop] = decl.value;
      });
    }
  });
  return result;
}
