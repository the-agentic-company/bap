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

/**
 * no-product-organization-import — keep Better Auth's physical organization
 * table out of product modules. Bap product code should import the `workspace`
 * alias from @bap/db/schema; only auth/schema/migration code should use the
 * Better Auth table name directly.
 */
const noProductOrganizationImport = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow importing Better Auth organization table directly from product modules.",
    },
    schema: [
      {
        type: "object",
        properties: {
          allow: {
            type: "array",
            items: { type: "string" },
          },
        },
        additionalProperties: false,
      },
    ],
  },
  create(context) {
    const allow = context.options?.[0]?.allow ?? [];
    const filename = context.filename ?? context.physicalFilename ?? "";
    const normalizedFilename = filename.replaceAll("\\", "/");
    const isAllowed = allow.some((pattern) => normalizedFilename.includes(pattern));

    if (isAllowed) {
      return {};
    }

    const isDbSchemaImport = (source) =>
      source === "@bap/db/schema" ||
      source === "@bap/db/src/schema" ||
      source.endsWith("/packages/db/src/schema") ||
      source.endsWith("/packages/db/src/schema/tables") ||
      source.endsWith("/packages/db/src/schema/tables-auth");

    return {
      ImportDeclaration(node) {
        if (!isDbSchemaImport(node.source?.value)) {
          return;
        }

        const importedOrganization = node.specifiers?.find(
          (specifier) =>
            specifier.type === "ImportSpecifier" && specifier.imported?.name === "organization",
        );

        if (!importedOrganization) {
          return;
        }

        context.report({
          node: importedOrganization,
          message:
            "Import the Bap `workspace` schema alias in product code. Direct `organization` imports are reserved for Better Auth integration, schema, migration, and focused tests.",
        });
      },
    };
  },
};

export default {
  meta: { name: "local" },
  rules: {
    "max-mocked-modules": maxMockedModules,
    "no-product-organization-import": noProductOrganizationImport,
  },
};
