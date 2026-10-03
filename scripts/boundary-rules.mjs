import { dirname, relative, resolve } from "node:path";
import ts from "typescript";
import { parse } from "@vue/compiler-sfc";

const transitionOwners = new Set([
  "composition/policy-services.ts",
  "execution/execution.ts",
  "invalidation/invalidation.ts",
  "mutations/mutation-commit.ts",
  "operations/operations.ts",
  "release-policies/policy-controller.ts",
]);
const capabilityAreas = new Set([
  "events",
  "execution",
  "invalidation",
  "mutations",
  "observation",
  "operations",
  "queries",
  "refresh-policies",
  "release-policies",
  "scheduling",
  "state",
  "subscriptions",
  "transactions",
]);
const diagnosticImplementations = new Set([
  "in-memory-diagnostics",
  "metrics",
  "snapshot-normaliser",
]);
const normalize = (path) => path.replaceAll("\\", "/");

/** Parses imports/re-exports/type imports/dynamic imports, including Vue script blocks. */
export const inspectBoundaries = (source, file, root) => {
  const issues = [];
  const local = normalize(relative(resolve(root, "src"), file));
  const layer = local.split("/")[0];
  const fragments = file.endsWith(".vue")
    ? (() => {
        const { descriptor, errors } = parse(source, { filename: file });
        if (errors.length) issues.push("Invalid Vue source");
        return [descriptor.script?.content, descriptor.scriptSetup?.content].filter(Boolean);
      })()
    : [source];
  const checkImport = (specifier) => {
    if (layer === "core" && /^(vue|pinia)(\/|$)/.test(specifier))
      issues.push(`Core cannot import ${specifier}`);
    let target;
    if (specifier.startsWith(".")) target = resolve(dirname(file), specifier);
    else if (specifier.startsWith("@/")) target = resolve(root, "src", specifier.slice(2));
    else if (specifier.startsWith("vue-dependency-graph/"))
      target = resolve(root, "src", specifier.slice("vue-dependency-graph/".length));
    if (!target) return;
    const targetPath = normalize(relative(resolve(root, "src"), target));
    const targetLayer = targetPath.split("/")[0];
    if (!targetPath.startsWith("../") && targetLayer !== layer) {
      const allowed =
        { core: [], vue: ["core"], devtools: ["core"], playground: ["core", "vue", "devtools"] }[
          layer
        ] ?? [];
      if (!allowed.includes(targetLayer)) issues.push(`${layer} cannot import ${targetLayer}`);
      else if (
        ![targetLayer, `${targetLayer}/index`, `${targetLayer}/index.ts`].includes(targetPath)
      )
        issues.push(
          `Cross-layer import must use the ${targetLayer} public entry point: ${specifier}`,
        );
    }
    if (layer === "core") {
      const coreFile = local.slice("core/".length);
      const coreTarget = targetPath.slice("core/".length).replace(/\.ts$/, "");
      if (coreTarget === "state/transitions" && !transitionOwners.has(coreFile))
        issues.push(`Unapproved state transition owner: ${coreFile}`);
      if (
        capabilityAreas.has(coreFile.split("/")[0]) &&
        coreTarget.startsWith("diagnostics/") &&
        diagnosticImplementations.has(coreTarget.split("/")[1])
      )
        issues.push(`Capability cannot import diagnostics implementation: ${specifier}`);
    }
  };
  for (const fragment of fragments) {
    const ast = ts.createSourceFile(file, fragment, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    if (ast.parseDiagnostics.length) issues.push("Invalid TypeScript source");
    const visit = (node) => {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteralLike(node.moduleSpecifier)
      )
        checkImport(node.moduleSpecifier.text);
      if (
        ts.isImportTypeNode(node) &&
        ts.isLiteralTypeNode(node.argument) &&
        ts.isStringLiteralLike(node.argument.literal)
      )
        checkImport(node.argument.literal.text);
      if (
        ts.isCallExpression(node) &&
        (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
          (ts.isIdentifier(node.expression) && node.expression.text === "require"))
      ) {
        const argument = node.arguments[0];
        if (argument && ts.isStringLiteralLike(argument)) checkImport(argument.text);
        else issues.push("Computed module imports cannot be boundary-checked");
      }
      if (
        layer === "core" &&
        local !== "core/state/transitions.ts" &&
        ts.isMappedTypeNode(node) &&
        node.readonlyToken?.kind === ts.SyntaxKind.MinusToken
      )
        issues.push("Writable mapped state types belong in state/transitions.ts");
      ts.forEachChild(node, visit);
    };
    visit(ast);
  }
  return [...new Set(issues)];
};
