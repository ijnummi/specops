import path from "node:path";
import ts from "typescript";

import type {
  ParseSourceFactsInput,
  ParseSourceFactsResult,
  SourceExportFact,
  SourceImportFact,
  SourceScanWarning,
  SourceSymbolFact
} from "./types.js";

export function parseSourceFacts(input: ParseSourceFactsInput): ParseSourceFactsResult {
  const sourceFile = ts.createSourceFile(
    input.path,
    input.content,
    ts.ScriptTarget.Latest,
    true,
    scriptKindForPath(input.path)
  );

  const imports: SourceImportFact[] = [];
  const exports: SourceExportFact[] = [];
  const symbols: SourceSymbolFact[] = [];
  const parseDiagnostics = (sourceFile as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics;
  const warnings: SourceScanWarning[] = parseDiagnostics.map((diagnostic) => ({
    code: "source_parse_error",
    message: ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n"),
    filePath: input.path
  }));
  const localExportedNames = collectLocalExportedNames(sourceFile);

  for (const statement of sourceFile.statements) {
    if (ts.isImportDeclaration(statement)) {
      imports.push(parseImportDeclaration(statement));
      continue;
    }

    if (ts.isExportDeclaration(statement)) {
      exports.push(...parseExportDeclaration(statement));
      continue;
    }

    if (ts.isFunctionDeclaration(statement) && statement.name) {
      const isDefaultExport = hasDefaultModifier(statement);
      const isExported = isDefaultExport || hasExportModifier(statement) || localExportedNames.has(statement.name.text);
      symbols.push(symbolFact(sourceFile, statement, statement.name.text, componentOr("function", statement.name.text), isExported));
      if (isDefaultExport) exports.push(defaultExport());
      else if (hasExportModifier(statement)) exports.push(namedExport(statement.name.text));
      continue;
    }

    if (ts.isClassDeclaration(statement) && statement.name) {
      const isDefaultExport = hasDefaultModifier(statement);
      const isExported = isDefaultExport || hasExportModifier(statement) || localExportedNames.has(statement.name.text);
      symbols.push(symbolFact(sourceFile, statement, statement.name.text, "class", isExported));
      if (isDefaultExport) exports.push(defaultExport());
      else if (hasExportModifier(statement)) exports.push(namedExport(statement.name.text));
      continue;
    }

    if (ts.isClassDeclaration(statement)) {
      if (hasDefaultModifier(statement)) exports.push(defaultExport());
      continue;
    }

    if (ts.isInterfaceDeclaration(statement)) {
      const isExported = hasExportModifier(statement) || localExportedNames.has(statement.name.text);
      symbols.push(symbolFact(sourceFile, statement, statement.name.text, "interface", isExported));
      if (hasExportModifier(statement)) exports.push({ exportedName: statement.name.text, exportKind: "type", sourceSpecifier: null });
      continue;
    }

    if (ts.isTypeAliasDeclaration(statement)) {
      const isExported = hasExportModifier(statement) || localExportedNames.has(statement.name.text);
      symbols.push(symbolFact(sourceFile, statement, statement.name.text, "type_alias", isExported));
      if (hasExportModifier(statement)) exports.push({ exportedName: statement.name.text, exportKind: "type", sourceSpecifier: null });
      continue;
    }

    if (ts.isEnumDeclaration(statement)) {
      const isExported = hasExportModifier(statement) || localExportedNames.has(statement.name.text);
      symbols.push(symbolFact(sourceFile, statement, statement.name.text, "enum", isExported));
      if (hasExportModifier(statement)) exports.push(namedExport(statement.name.text));
      continue;
    }

    if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (!ts.isIdentifier(declaration.name)) continue;
        const name = declaration.name.text;
        const isExported = hasExportModifier(statement) || localExportedNames.has(name);
        symbols.push(symbolFact(sourceFile, declaration, name, variableSymbolKind(name, declaration), isExported));
        if (hasExportModifier(statement)) exports.push(namedExport(name));
      }
      continue;
    }

    if (ts.isExportAssignment(statement) && !statement.isExportEquals) {
      exports.push(defaultExport());
    }
  }

  return { imports, exports, symbols, warnings };
}

function scriptKindForPath(filePath: string): ts.ScriptKind {
  const extension = path.extname(filePath);
  if (extension === ".tsx") return ts.ScriptKind.TSX;
  if (extension === ".jsx") return ts.ScriptKind.JSX;
  if (extension === ".js" || extension === ".mjs" || extension === ".cjs") return ts.ScriptKind.JS;
  if (extension === ".ts" || extension === ".mts" || extension === ".cts") return ts.ScriptKind.TS;
  return ts.ScriptKind.Unknown;
}

function parseImportDeclaration(node: ts.ImportDeclaration): SourceImportFact {
  const specifier = stringLiteralText(node.moduleSpecifier);
  const importClause = node.importClause;
  const importedNames: string[] = [];

  if (!importClause) {
    return importFact(specifier, "side_effect", importedNames);
  }

  const isTypeOnly = importClause.isTypeOnly;
  if (importClause.name) importedNames.push("default");

  const namedBindings = importClause.namedBindings;
  if (namedBindings && ts.isNamespaceImport(namedBindings)) {
    importedNames.push(namedBindings.name.text);
    return importFact(specifier, isTypeOnly ? "type" : importClause.name ? "mixed" : "namespace", importedNames);
  }

  if (namedBindings && ts.isNamedImports(namedBindings)) {
    for (const element of namedBindings.elements) {
      importedNames.push((element.propertyName ?? element.name).text);
    }
  }

  if (isTypeOnly) return importFact(specifier, "type", importedNames);
  if (importClause.name && namedBindings) return importFact(specifier, "mixed", importedNames);
  if (importClause.name) return importFact(specifier, "default", importedNames);
  return importFact(specifier, "named", importedNames);
}

function parseExportDeclaration(node: ts.ExportDeclaration): SourceExportFact[] {
  const sourceSpecifier = node.moduleSpecifier ? stringLiteralText(node.moduleSpecifier) : null;
  const exportClause = node.exportClause;

  if (!exportClause) {
    return [{ exportedName: "*", exportKind: "namespace", sourceSpecifier }];
  }

  if (ts.isNamespaceExport(exportClause)) {
    return [{ exportedName: exportClause.name.text, exportKind: "namespace", sourceSpecifier }];
  }

  return exportClause.elements.map((element) => ({
    exportedName: element.name.text,
    exportKind: node.isTypeOnly ? "type" : sourceSpecifier ? "re_export" : "named",
    sourceSpecifier
  }));
}

function collectLocalExportedNames(sourceFile: ts.SourceFile): Set<string> {
  const names = new Set<string>();

  for (const statement of sourceFile.statements) {
    if (!ts.isExportDeclaration(statement) || statement.moduleSpecifier || !statement.exportClause) continue;
    if (!ts.isNamedExports(statement.exportClause)) continue;

    for (const element of statement.exportClause.elements) {
      names.add((element.propertyName ?? element.name).text);
    }
  }

  return names;
}

function importFact(specifier: string, importKind: SourceImportFact["importKind"], importedNames: string[]): SourceImportFact {
  return {
    specifier,
    importKind,
    importedNames,
    isRelative: specifier.startsWith("./") || specifier.startsWith("../"),
    resolvedPath: null
  };
}

function namedExport(exportedName: string): SourceExportFact {
  return { exportedName, exportKind: "named", sourceSpecifier: null };
}

function defaultExport(): SourceExportFact {
  return { exportedName: "default", exportKind: "default", sourceSpecifier: null };
}

function hasExportModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword);
}

function hasDefaultModifier(node: ts.Node): boolean {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((modifier) => modifier.kind === ts.SyntaxKind.DefaultKeyword);
}

function symbolFact(
  sourceFile: ts.SourceFile,
  node: ts.Node,
  name: string,
  symbolKind: string,
  isExported: boolean
): SourceSymbolFact {
  return {
    name,
    symbolKind,
    isExported,
    line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
    metadata: {}
  };
}

function variableSymbolKind(name: string, declaration: ts.VariableDeclaration): string {
  if (
    isPascalCase(name) &&
    declaration.initializer &&
    (ts.isArrowFunction(declaration.initializer) || ts.isFunctionExpression(declaration.initializer))
  ) {
    return "react_component";
  }

  return "constant";
}

function componentOr(symbolKind: string, name: string): string {
  return isPascalCase(name) ? "react_component" : symbolKind;
}

function isPascalCase(value: string): boolean {
  return /^[A-Z][A-Za-z0-9]*$/.test(value);
}

function stringLiteralText(node: ts.Expression): string {
  return ts.isStringLiteralLike(node) ? node.text : node.getText();
}
