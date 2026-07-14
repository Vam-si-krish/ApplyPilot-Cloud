import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

const root = process.cwd();
const ignoredDirectories = new Set(['.git', '.next', 'node_modules']);
const ignoredPaths = new Set(['backend/data', 'backend/backups', 'backend/logs']);

function markdownFiles(dir = root) {
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    const rel = relative(root, path);
    if (entry.isDirectory()) {
      if (ignoredDirectories.has(entry.name)) continue;
      if ([...ignoredPaths].some((prefix) => rel === prefix || rel.startsWith(`${prefix}/`))) continue;
      out.push(...markdownFiles(path));
    } else if (entry.isFile() && entry.name.endsWith('.md')) {
      out.push(path);
    }
  }
  return out;
}

const failures = [];
const required = ['AGENTS.md', 'CLAUDE.md', 'docs/DEVELOPMENT.md', 'docs/ARCHITECTURE.md', 'docs/PRD.md'];
for (const file of required) {
  if (!existsSync(join(root, file))) failures.push(`missing required living document: ${file}`);
}

const files = markdownFiles();
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  const links = text.matchAll(/!?\[[^\]]*\]\((<[^>]+>|[^)]+)\)/g);
  for (const match of links) {
    let target = match[1].trim().replace(/^<|>$/g, '');
    if (!target || /^(?:https?:|mailto:|tel:|#)/i.test(target)) continue;
    target = target.split('#')[0].split('?')[0];
    if (!target) continue;
    let decoded = target;
    try { decoded = decodeURIComponent(target); } catch { /* report the literal path */ }
    const absolute = resolve(dirname(file), decoded);
    if (!existsSync(absolute)) failures.push(`${relative(root, file)}: broken link → ${match[1]}`);
  }
}

const adrNumbers = new Map();
for (const name of readdirSync(join(root, 'docs', 'adr'))) {
  const match = name.match(/^(\d{4})-.*\.md$/);
  if (!match) continue;
  if (adrNumbers.has(match[1])) failures.push(`duplicate ADR number ${match[1]}: ${adrNumbers.get(match[1])}, ${name}`);
  adrNumbers.set(match[1], name);
}

const devlogs = readdirSync(join(root, 'docs', 'devlog')).filter((name) => /^DAY-\d+\.md$/.test(name));
if (devlogs.length === 0) failures.push('docs/devlog has no DAY-N.md files');

if (failures.length) {
  console.error(`Documentation check failed (${failures.length}):`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`Documentation check passed: ${files.length} Markdown files, ${adrNumbers.size} ADRs.`);
