// Local oxlint JS plugin (alpha API): project-specific "design-lint" rules that
// run inside oxlint alongside the built-in rules. Loaded via `jsPlugins` in
// .oxlintrc.json. Rules are referenced as `local/<rule-name>` (namespace = meta.name).

/**
 * max-mocked-modules — flag test files that mock too many *distinct modules*.
 *
 * The count of distinct `vi.mock("…")` specifiers ≈ how many collaborators the
 * unit under test depends on. A high count is a design smell (over-coupled
 * god-object), not a test-formatting problem — splitting such a test by line
 * count just spreads the smell. The fix is to extract a smaller unit.
 */
const maxMockedModules = {
  meta: {
    type: "suggestion",
    docs: {
      description:
        "Flag test files that mock too many distinct modules (over-coupled unit under test).",
    },
    schema: [
      {
        type: "object",
        properties: { max: { type: "integer", minimum: 1 } },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const max = context.options?.[0]?.max ?? 10;
    const mocked = new Set();
    let firstNode = null;

    const isViMock = (callee) =>
      callee?.type === "MemberExpression" &&
      callee.object?.type === "Identifier" &&
      callee.object.name === "vi" &&
      callee.property?.type === "Identifier" &&
      (callee.property.name === "mock" || callee.property.name === "doMock");

    return {
      CallExpression(node) {
        if (!isViMock(node.callee)) return;
        const arg = node.arguments?.[0];
        if (arg && arg.type === "Literal" && typeof arg.value === "string") {
          mocked.add(arg.value);
          firstNode ??= node;
        }
      },
      "Program:exit"() {
        if (mocked.size > max) {
          const sample = [...mocked].slice(0, 8).join(", ");
          context.report({
            node: firstNode,
            message:
              `This test mocks ${mocked.size} distinct modules (max ${max}). ` +
              `The unit under test has too many collaborators — extract a smaller unit ` +
              `instead of slicing the test. Mocked: ${sample}`,
          });
        }
      },
    };
  },
};

export default {
  meta: { name: "local" },
  rules: { "max-mocked-modules": maxMockedModules },
};
