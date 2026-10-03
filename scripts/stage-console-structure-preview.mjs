import fs from "node:fs/promises";
import path from "node:path";
import ts from "typescript";

// Mirror the real client component graph outside iCloud; never copy env files or API routes.
// node scripts/stage-console-structure-preview.mjs /tmp/monstera-production-console-preview-20261002
const repo = process.cwd();
const target = path.resolve(process.argv[2] || "/tmp/monstera-production-console-preview-20261002");
if (target === repo || !target.startsWith("/tmp/monstera-")) throw new Error("Choose a separate /tmp/monstera-* preview directory.");
const pkg = JSON.parse(await fs.readFile(path.join(repo, "package.json"), "utf8"));
const lock = JSON.parse(await fs.readFile(path.join(repo, "package-lock.json"), "utf8"));
const seen = new Set();
const externals = new Set();
function mirrorName(file) { return file.replace(/^src\/app\/\(app\)\//, "src/production/"); }
async function resolveLocal(specifier, from) {
  const base = specifier.startsWith("@/") ? path.join(repo, "src", specifier.slice(2)) : path.resolve(path.dirname(path.join(repo, from)), specifier);
  for (const candidate of [base, ...[".tsx", ".ts", ".jsx", ".js", ".mjs", ".css", "/index.tsx", "/index.ts", "/index.js"].map(ext => base + ext)]) {
    try { if ((await fs.stat(candidate)).isFile()) return path.relative(repo, candidate); } catch {}
  }
  throw new Error(`Cannot resolve ${specifier} from ${from}`);
}
async function copy(file) {
  if (seen.has(file)) return;
  seen.add(file);
  const content = await fs.readFile(path.join(repo, file), "utf8");
  const destination = path.join(target, mirrorName(file));
  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, content.replaceAll("@/app/(app)/", "@/production/"));
  if (file.endsWith(".css")) {
    for (const match of content.matchAll(/@import\s+["']([^"']+)["']/g)) {
      if (match[1].startsWith(".")) await copy(await resolveLocal(match[1], file));
    }
    return;
  }
  const source = ts.createSourceFile(file, content, ts.ScriptTarget.Latest, true);
  const imports = [];
  function visit(node) {
    if (ts.isImportDeclaration(node) && !node.importClause?.isTypeOnly && !(node.importClause?.namedBindings && ts.isNamedImports(node.importClause.namedBindings) && !node.importClause.name && node.importClause.namedBindings.elements.every(element => element.isTypeOnly))) imports.push(node.moduleSpecifier.text);
    if (ts.isExportDeclaration(node) && !node.isTypeOnly && node.moduleSpecifier) imports.push(node.moduleSpecifier.text);
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && ts.isStringLiteral(node.arguments[0])) imports.push(node.arguments[0].text);
    ts.forEachChild(node, visit);
  }
  visit(source);
  for (const specifier of imports) {
    if (specifier.startsWith("@/") || specifier.startsWith(".")) await copy(await resolveLocal(specifier, file));
    else if (!specifier.startsWith("node:")) externals.add(specifier.startsWith("@") ? specifier.split("/").slice(0, 2).join("/") : specifier.split("/")[0]);
  }
}
await copy("src/app/demo/ui/console-structure/[[...consolePath]]/page.tsx");
await copy("src/app/demo/ui/console-structure/layout.tsx");
await copy("src/app/globals.css");
const dependencies = {};
for (const name of [...externals, "react-dom", "tailwindcss", "postcss", "postcss-nesting", "@tailwindcss/postcss", "typescript", "@types/react", "@types/node"]) {
  if (name === "server-only") continue;
  const version = lock.packages?.[`node_modules/${name}`]?.version || pkg.dependencies?.[name] || pkg.devDependencies?.[name];
  if (!version) throw new Error(`No locked version for ${name}`);
  dependencies[name] = version;
}
await fs.writeFile(path.join(target, "package.json"), JSON.stringify({ name: "monstera-production-console-review", private: true, scripts: { dev: "next dev --hostname 127.0.0.1 --port 3013 --disable-source-maps" }, dependencies }, null, 2));
await fs.copyFile(path.join(repo, "postcss.config.mjs"), path.join(target, "postcss.config.mjs"));
await fs.mkdir(path.join(target, "src/app"), { recursive: true });
await fs.writeFile(path.join(target, "src/app/layout.tsx"), 'import "./globals.css"; export default function Layout({children}: {children: React.ReactNode}) { return <html lang="en" className="dark"><body>{children}</body></html>; }');
await fs.writeFile(path.join(target, "tsconfig.json"), JSON.stringify({ compilerOptions: { target: "ES2017", lib: ["dom", "dom.iterable", "esnext"], strict: true, skipLibCheck: true, noEmit: true, jsx: "react-jsx", module: "esnext", moduleResolution: "bundler", esModuleInterop: true, resolveJsonModule: true, isolatedModules: true, baseUrl: ".", paths: { "@/*": ["./src/*"] } }, include: ["**/*.ts", "**/*.tsx", ".next/types/**/*.ts"] }, null, 2));
await fs.writeFile(path.join(target, "next.config.mjs"), 'export default { devIndicators: false, turbopack: { root: import.meta.dirname }, typescript: { ignoreBuildErrors: true }, distDir: process.env.MONSTERA_PREVIEW_BUILD === "1" ? ".next-review-build" : ".next" };');
await fs.cp(path.join(repo, "public"), path.join(target, "public"), { recursive: true });
console.log(JSON.stringify({ target, files: seen.size, dependencies: Object.keys(dependencies) }, null, 2));
