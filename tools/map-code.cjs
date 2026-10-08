#!/usr/bin/env node
// Run with: node --expose-internals tools/map-code.cjs
// This is an audit tool for the repository's Node 20+ environment. It uses the
// Acorn parser bundled with Node, so it does not add a production dependency.
const fs = require('node:fs');
const path = require('node:path');

let acorn, walk;
try {
  acorn = require('internal/deps/acorn/acorn/dist/acorn');
  walk = require('internal/deps/acorn/acorn-walk/dist/walk');
} catch {
  console.error('Run this audit with: node --expose-internals tools/map-code.cjs');
  process.exit(1);
}

const root = path.resolve(__dirname, '..');
const docs = path.join(root, 'docs');
const excluded = new Set(['.git', '.catalogue', 'backups', 'dist', 'node_modules', 'test', 'tools']);
const pages = ['index.html', 'firm.html', 'firms.html', 'about.html'];

function sourceFiles(dir = '') {
  return fs.readdirSync(path.join(root, dir), { withFileTypes: true })
    .flatMap(entry => {
      const name = path.join(dir, entry.name);
      if (entry.isDirectory()) return excluded.has(entry.name) ? [] : sourceFiles(name);
      return /\.(js|cjs|mjs)$/.test(entry.name) ? [name] : [];
    })
    .sort();
}

function parse(file, source) {
  const options = { ecmaVersion: 'latest', locations: true };
  try { return acorn.parse(source, { ...options, sourceType: 'script' }); }
  catch (scriptError) {
    try { return acorn.parse(source, { ...options, sourceType: 'module' }); }
    catch { throw new Error(`${file}: ${scriptError.message}`); }
  }
}

function functionName(node, parent) {
  if (node.id?.name) return node.id.name;
  if (parent?.type === 'VariableDeclarator' && parent.id.type === 'Identifier') return parent.id.name;
  if (['Property', 'MethodDefinition'].includes(parent?.type)) return parent.key?.name || String(parent.key?.value || 'anonymous');
  if (parent?.type === 'AssignmentExpression' && parent.left.type === 'MemberExpression') return parent.left.property.name || 'anonymous';
  return 'anonymous';
}

function inspect(file) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  const ast = parse(file, source);
  const imports = new Set();
  const reads = new Set();
  const writes = new Set();
  const functions = [];
  const topLevel = new Set();

  for (const item of ast.body) {
    if (item.type === 'VariableDeclaration') {
      for (const declaration of item.declarations) {
        if (declaration.id.type === 'Identifier') topLevel.add(declaration.id.name);
      }
    }
    if (item.type === 'FunctionDeclaration' && item.id) topLevel.add(item.id.name);
  }

  walk.fullAncestor(ast, (node, ancestors) => {
    const parent = ancestors[ancestors.length - 2];
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' &&
        node.callee.name === 'require' && node.arguments[0]?.type === 'Literal') {
      imports.add(node.arguments[0].value);
    }
    if (node.type === 'ImportDeclaration') imports.add(node.source.value);
    if (node.type === 'ImportExpression' && node.source.type === 'Literal') imports.add(node.source.value);
    if (node.type === 'MemberExpression' && !node.computed && node.object.type === 'Identifier' &&
        ['window', 'global', 'globalThis'].includes(node.object.name)) {
      const target = parent?.type === 'AssignmentExpression' && parent.left === node ? writes : reads;
      target.add(node.property.name);
    }
    if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)) {
      functions.push({ name: functionName(node, parent), line: node.loc.start.line,
        lines: node.loc.end.line - node.loc.start.line + 1 });
    }
  });

  return { file, lines: source.split('\n').length, functionCount: functions.length,
    functions: functions.sort((a, b) => a.line - b.line || b.lines - a.lines),
    imports: [...imports].sort(), browserGlobals: { reads: [...reads].sort(), writes: [...writes].sort(),
      topLevel: [...topLevel].sort() } };
}

function resolveImport(from, specifier, known) {
  if (!specifier.startsWith('.')) return null;
  const base = path.normalize(path.join(path.dirname(from), specifier));
  return ['', '.js', '.cjs', '.mjs', '/index.js'].map(suffix => base + suffix).find(name => known.has(name)) || null;
}

function cyclesFor(files, edges) {
  const adjacency = new Map(files.map(file => [file, []]));
  for (const [from, to] of edges) adjacency.get(from).push(to);
  const state = new Map();
  const cycles = [];
  function visit(file, stack) {
    if (state.get(file) === 1) { cycles.push([...stack.slice(stack.indexOf(file)), file]); return; }
    if (state.get(file) === 2) return;
    state.set(file, 1);
    for (const next of adjacency.get(file)) visit(next, [...stack, file]);
    state.set(file, 2);
  }
  for (const file of files) visit(file, []);
  return cycles;
}

function id(prefix, index) { return prefix + index; }
function label(value) { return value.replaceAll('"', '&quot;'); }

function diagram(nodes, edges, prefix) {
  const ids = new Map(nodes.map((name, index) => [name, id(prefix, index)]));
  return ['flowchart LR',
    ...nodes.map(name => `  ${ids.get(name)}["${label(name)}"]`),
    ...edges.map(([from, to]) => `  ${ids.get(from)} --> ${ids.get(to)}`),
  ].join('\n');
}

function main() {
  const files = sourceFiles().map(inspect);
  const known = new Set(files.map(item => item.file));
  const moduleEdges = files.flatMap(item => item.imports
    .map(specifier => resolveImport(item.file, specifier, known))
    .filter(Boolean).map(target => [item.file, target]));
  const scripts = Object.fromEntries(pages.map(page => [page,
    [...fs.readFileSync(path.join(root, page), 'utf8').matchAll(/<script\s+src="([^"]+)"/g)]
      .map(match => match[1])]));
  const pageEdges = Object.entries(scripts).flatMap(([page, loaded]) => loaded.map(script => [page, script]));
  const producers = new Map();
  for (const item of files) for (const symbol of item.browserGlobals.writes) {
    if (!producers.has(symbol)) producers.set(symbol, []);
    producers.get(symbol).push(item.file);
  }
  const sharedPage = (first, second) => Object.values(scripts)
    .some(loaded => loaded.includes(first) && loaded.includes(second));
  const globalEdges = files.flatMap(item => item.browserGlobals.reads.flatMap(symbol =>
    (producers.get(symbol) || []).filter(owner => owner !== item.file && sharedPage(item.file, owner))
      .map(owner => [item.file, owner, symbol])));
  const graph = { moduleEdges, pageEdges, globalEdges,
    cycles: cyclesFor(files.map(item => item.file), moduleEdges) };
  const map = { scope: 'Runtime JavaScript; excludes tests, generated output, and dependencies.',
    parser: 'Acorn bundled with Node (requires --expose-internals)',
    summary: { files: files.length, functions: files.reduce((sum, item) => sum + item.functionCount, 0),
      lines: files.reduce((sum, item) => sum + item.lines, 0), moduleEdges: moduleEdges.length,
      pageEdges: pageEdges.length, globalEdges: globalEdges.length, cycles: graph.cycles.length },
    files, pages: scripts, graph };

  const moduleNodes = [...new Set(moduleEdges.flat())].sort();
  const browserNodes = [...new Set(pageEdges.flat())].sort();
  const globalNodes = [...new Set(globalEdges.flatMap(([from, to]) => [from, to]))].sort();
  const linked = new Set([...moduleNodes, ...browserNodes]);
  const standalone = files.map(item => item.file).filter(file => !linked.has(file));
  const markdown = `# Generated dependency graphs\n\n` +
    `Run \`node --expose-internals tools/map-code.cjs\` from the repository root to update this file and [the AST map](ast-map.json).\n\n` +
    `These arrows are direct static dependencies. The module diagram includes literal \`require\` and \`import\` targets. The page diagram shows scripts loaded by each HTML page; it does not claim every script calls every other script. The global diagram covers direct property reads; dynamic calls and bare global identifiers need manual review.\n\n` +
    `## Module imports\n\n\`\`\`mermaid\n${diagram(moduleNodes, moduleEdges, 'm')}\n\`\`\`\n\n` +
    `## Browser script loads\n\n\`\`\`mermaid\n${diagram(browserNodes, pageEdges, 'b')}\n\`\`\`\n\n` +
    `## Implicit browser globals\n\n` +
    `Dashed arrows show direct \`window\`/\`global\` property reads, from consumer to producer, where both scripts load on the same page. Bare identifiers such as \`VC_FIRMS\` and \`JobsAPI\` may add further coupling and require scope-aware analysis.\n\n` +
    `\`\`\`mermaid\n${diagram(globalNodes, [...new Map(globalEdges.map(([from, to]) => [`${from}\0${to}`, [from, to]])).values()], 'g').replaceAll(' --> ', ' -.-> ')}\n\`\`\`\n\n` +
    `| Consumer | Provider | Global |\n|---|---|---|\n` +
    globalEdges.map(([from, to, symbol]) => `| \`${from}\` | \`${to}\` | \`${symbol}\` |`).join('\n') + '\n\n' +
    `## Browser script order\n\n` +
    Object.entries(scripts).map(([page, loaded]) => `- **${page}:** ${loaded.map(name => `\`${name}\``).join(' → ')}`).join('\n') + '\n\n' +
    `## Standalone files\n\n` +
    `These files have no local module edge and are not loaded by the four HTML pages. This includes command-line entry points and the separate Cloudflare Worker; it is not a dead-code finding by itself.\n\n` +
    standalone.map(file => `- \`${file}\``).join('\n') + '\n';

  fs.mkdirSync(docs, { recursive: true });
  fs.writeFileSync(path.join(docs, 'ast-map.json'), JSON.stringify(map, null, 2) + '\n');
  fs.writeFileSync(path.join(docs, 'dependency-graph.md'), markdown);
  console.log(`Mapped ${map.summary.files} files, ${map.summary.functions} functions, ` +
    `${map.summary.moduleEdges} module edges, ${map.summary.pageEdges} page edges, ` +
    `${map.summary.globalEdges} global edges, ` +
    `${map.summary.cycles} cycles.`);
}

main();
