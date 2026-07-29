import { readFileSync, readdirSync } from 'node:fs';
import { relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const sourceRoot = resolve(root, 'src');
const contract = JSON.parse(readFileSync(resolve(root, 'scripts', 'architecture-contract.json'), 'utf8'));
const enforce = process.argv.includes('--enforce');

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(path);
    return /\.(?:ts|vue)$/.test(entry.name) && !entry.name.endsWith('.test.ts') ? [path] : [];
  });
}

const metricPatterns = {
  globalBridgeReferences: [
    /\bglobalFunction\s*\(/g,
    /\blegacyFunction\s*\(/g,
    /\bcallLegacy\s*\(/g,
    /\binstall[A-Z]\w*Globals\s*\(/g,
    /window\s+as\s+typeof\s+window\s*&/g,
  ],
  domQueries: [
    /\bgetElementById(?:<[^>]+>)?\s*\(/g,
    /\bquerySelector(?:All)?(?:<[^>]+>)?\s*\(/g,
  ],
  htmlWrites: [
    /\.innerHTML\s*=/g,
    /\.outerHTML\s*=/g,
    /\.insertAdjacentHTML\s*\(/g,
  ],
};

function countMatches(source, patterns) {
  return patterns.reduce((total, pattern) => total + [...source.matchAll(pattern)].length, 0);
}

const rows = sourceFiles(sourceRoot).map((path) => {
  const source = readFileSync(path, 'utf8');
  const metrics = Object.fromEntries(Object.entries(metricPatterns).map(([name, patterns]) => [name, countMatches(source, patterns)]));
  return { file: relative(root, path).replaceAll('\\', '/'), ...metrics };
});

const totals = Object.fromEntries(Object.keys(metricPatterns).map((name) => [
  name,
  rows.reduce((total, row) => total + row[name], 0),
]));

const activeRows = rows.filter((row) => Object.keys(metricPatterns).some((name) => row[name] > 0));
console.table(activeRows);
console.log('Architecture migration metrics:', totals);
console.log('Final target:', contract.finalTarget);

if (enforce) {
  const failures = Object.entries(contract.currentMaximum)
    .filter(([name, maximum]) => totals[name] > maximum)
    .map(([name, maximum]) => `${name}: ${totals[name]} exceeds ${maximum}`);
  if (failures.length) throw new Error(`Architecture contract regressed:\n${failures.join('\n')}`);
}
