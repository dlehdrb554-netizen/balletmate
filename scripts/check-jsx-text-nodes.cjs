const fs = require("node:fs");
const path = require("node:path");
const ts = require("typescript");
const roots = ["app", "components"];
const files = [];
function collect(dir) {
  if (!fs.existsSync(dir)) return;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) collect(full);
    else if (/\.tsx?$/.test(entry.name)) files.push(full);
  }
}
roots.forEach(collect);
const issues = [];
function tagName(node) {
  if (!node || !node.tagName) return "";
  if (ts.isIdentifier(node.tagName)) return node.tagName.text;
  if (ts.isPropertyAccessExpression(node.tagName)) return node.tagName.name.text;
  return "";
}
for (const file of files) {
  const source = fs.readFileSync(file, "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  function visit(node, parentIsText) {
    if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) {
      const currentIsText = tagName(node.openingElement || node) === "Text";
      if (ts.isJsxElement(node)) node.children.forEach(child => visit(child, currentIsText));
      return;
    }
    if (ts.isJsxFragment(node)) { node.children.forEach(child => visit(child, parentIsText)); return; }
    if (!parentIsText && ts.isJsxText(node)) {
      const raw = node.getText(ast);
      if (raw.trim().length > 0 || (raw.length > 0 && !/[\r\n]/.test(raw))) {
        const pos = ast.getLineAndCharacterOfPosition(node.getStart(ast));
        issues.push(file + ":" + (pos.line + 1) + ":" + (pos.character + 1) + " raw JSX text outside <Text>: " + JSON.stringify(raw));
      }
    }
    if (!parentIsText && ts.isJsxExpression(node) && node.expression) {
      const expression = node.expression;
      if ((ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression) || ts.isNumericLiteral(expression)) && String(expression.text).length > 0) {
        const pos = ast.getLineAndCharacterOfPosition(node.getStart(ast));
        issues.push(file + ":" + (pos.line + 1) + ":" + (pos.character + 1) + " literal JSX expression outside <Text>: " + expression.getText(ast));
      }
    }
    ts.forEachChild(node, child => visit(child, parentIsText));
  }
  visit(ast, false);
}
if (issues.length) {
  console.error("React Native raw text nodes detected:");
  issues.forEach(issue => console.error(" - " + issue));
  process.exit(1);
}
console.log("Checked " + files.length + " TS/TSX files: no raw text nodes outside <Text>.");
