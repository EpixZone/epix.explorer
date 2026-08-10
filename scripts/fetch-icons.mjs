#!/usr/bin/env node
// Regenerates the offline Iconify icon bundle in src/assets/icons/.
// Scans src/ for icon names (mdi:foo, mdi-foo, simple-icons:bar, ...), fetches
// the icon data once from the Iconify API, and writes one JSON collection per
// prefix. The app registers these via addCollection() in src/plugins/icons.ts,
// so no runtime requests to api.iconify.design are needed.
//
// Run whenever icons are added/changed:  node scripts/fetch-icons.mjs

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = join(root, 'src');
const outDir = join(srcDir, 'assets', 'icons');

const PREFIXES = ['mdi', 'simple-icons', 'logos', 'token-branded', 'cryptocurrency', 'carbon', 'heroicons', 'tabler', 'uil'];

function walk(dir, files = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) walk(p, files);
    else if (/\.(vue|ts|tsx|js)$/.test(entry.name)) files.push(p);
  }
  return files;
}

const icons = {}; // prefix -> Set of names
const re = new RegExp(`['"\`](${PREFIXES.join('|')})[:-]([a-z0-9-]+)['"\`]`, 'g');
for (const file of walk(srcDir)) {
  const text = readFileSync(file, 'utf8');
  for (const m of text.matchAll(re)) {
    (icons[m[1]] ??= new Set()).add(m[2]);
  }
}

mkdirSync(outDir, { recursive: true });
for (const [prefix, names] of Object.entries(icons)) {
  const list = [...names].sort();
  const url = `https://api.iconify.design/${prefix}.json?icons=${list.join(',')}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${prefix}: HTTP ${res.status}`);
  const data = await res.json();
  if (data.not_found?.length) {
    console.warn(`WARNING [${prefix}] not found (typo or removed upstream):`, data.not_found.join(', '));
  }
  delete data.not_found;
  writeFileSync(join(outDir, `${prefix}.json`), JSON.stringify(data));
  console.log(`${prefix}: ${Object.keys(data.icons || {}).length} icons (+${Object.keys(data.aliases || {}).length} aliases)`);
}
