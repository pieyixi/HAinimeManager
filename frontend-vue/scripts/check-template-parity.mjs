import { readFileSync, readdirSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const contract = JSON.parse(readFileSync(resolve(root, 'scripts', 'ui-contract.json'), 'utf8'));
const componentDir = resolve(root, 'src', 'components');
const componentHtml = readdirSync(componentDir)
  .filter((name) => name.endsWith('.vue'))
  .sort()
  .map((name) => readFileSync(resolve(componentDir, name), 'utf8'))
  .join('\n');

function readSourceTree(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) return readSourceTree(path);
    return /\.(?:ts|vue)$/.test(entry.name) ? [readFileSync(path, 'utf8')] : [];
  }).join('\n');
}

const applicationSource = readSourceTree(resolve(root, 'src'));

function values(source, expression) {
  return [...source.matchAll(expression)].map((match) => match[1]).sort();
}

function unique(valuesToDedupe) {
  return [...new Set(valuesToDedupe)].sort();
}

function compare(label, expected, actual) {
  const missing = expected.filter((value) => !actual.includes(value));
  const added = actual.filter((value) => !expected.includes(value));
  if (!missing.length && !added.length) return;

  const details = [
    missing.length ? `missing: ${missing.join(', ')}` : '',
    added.length ? `added: ${added.join(', ')}` : '',
  ].filter(Boolean).join('\n  ');
  throw new Error(`${label} differs from the legacy template\n  ${details}`);
}

const componentIds = unique(values(componentHtml, /(?:^|\s)id="([^"]+)"/gm));
compare('DOM ids', contract.ids.slice().sort(), componentIds);

const handlerPattern = /\bon(?:click|input|focus|blur|keydown|mouseenter|mouseleave|pointerdown|pointermove|pointerup|pointercancel|pointerleave)="([^"]+)"/g;
const componentHandlers = unique(values(componentHtml, handlerPattern));
if (componentHandlers.length) throw new Error(`Inline handlers are forbidden in Vue templates: ${componentHandlers.join(', ')}`);
const generatedInlineHandlers = unique(values(applicationSource, /\bon(?:click|input|focus|blur|keydown|contextmenu|error|mouseenter|mouseleave|pointerdown|pointermove|pointerup|pointercancel|pointerleave)=\\?"([^"\n]+)"/g));
if (generatedInlineHandlers.length) throw new Error(`Inline handlers are forbidden in generated markup: ${generatedInlineHandlers.join(', ')}`);

const requiredPages = contract.pages;
compare('Page roots', requiredPages.slice().sort(), componentIds.filter((id) => id.startsWith('page-')));

console.log(`Vue UI contract verified: ${componentIds.length} ids; no inline handlers.`);
