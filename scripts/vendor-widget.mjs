#!/usr/bin/env node
// Vendors @muddydev/epixzone-widget into public/ so the explorer has no
// external dependencies at runtime (required when served from .epix domains,
// which cannot reach unpkg.com / fonts.googleapis.com / api.iconify.design).
//
// What it does:
//  1. Downloads dist/widget.js and every chunk it references from unpkg.
//  2. Strips the Google Fonts @import from the widget's injected CSS
//     (the app already self-hosts Inter — see src/assets/fonts/).
//  3. Rewrites the widget's bundled Iconify API base from
//     https://api.iconify.design to ./iconify, and writes the icon data the
//     widget needs to public/iconify/mdi.json. Static servers ignore the
//     ?icons=... query, so the full local collection is served instead.
//
// Re-run to pick up a new widget version:  node scripts/vendor-widget.mjs

import { writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = 'https://unpkg.com/@muddydev/epixzone-widget@latest/dist';
const pub = join(dirname(fileURLToPath(import.meta.url)), '..', 'public');

// remote images the widget shows (wallet/token logos) -> local files.
// Targets already in public/logos/ are reused; missing ones are downloaded
// from the original URL into public/logos/vendor/.
const IMAGE_REWRITES = {
  'https://ping.pub/logos/keplr-logo.svg': './logos/Keplr.png',
  'https://ping.pub/logos/metamask.png': './logos/MetaMask.png',
  'https://assets.leapwallet.io/logos/leap-cosmos-logo.svg': './logos/Leap.png',
  'https://ping.pub/logos/ledger.webp': './logos/vendor/ledger.webp',
  'https://raw.githubusercontent.com/cosmos/chain-registry/master/_non-cosmos/bitcoin/images/btc.svg': './logos/vendor/btc.svg',
  'https://raw.githubusercontent.com/cosmos/chain-registry/master/_non-cosmos/ethereum/images/usdc.svg': './logos/vendor/usdc.svg',
  'https://raw.githubusercontent.com/cosmos/chain-registry/master/osmosis/images/osmo.svg': './logos/vendor/osmo.svg',
  // not referenced by the upstream widget — downloaded for the injected allUSDT entry below
  'https://raw.githubusercontent.com/cosmos/chain-registry/master/_non-cosmos/ethereum/images/usdt.svg': './logos/vendor/usdt.svg',
};

// swap token list patch: prepend alloyed USDT and make it the default
// (the swap dialog uses tokens[0] as the default asset). Anchored on the
// upstream USDC entry so the patch fails loudly if the widget's list changes.
const TOKENS_ANCHOR = 'const tokens = [\n  {\n    denom: "uusdc"';
const TOKENS_PATCHED = `const tokens = [
  {
    denom: "allUSDT",
    symbol: "USDT",
    ibcDenom: "factory/osmo1em6xs47hd82806f5cxgyufguxrrc7l0aqx7nzzptjuqgswczk8csavdxek/alloyed/allUSDT",
    decimals: 6,
    coinImageUrl: "./logos/vendor/usdt.svg"
  },
  {
    denom: "uusdc"`;

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
  return res.text();
}

const seen = new Set();
async function vendor(name) {
  if (seen.has(name)) return;
  seen.add(name);
  let code = await fetchText(`${BASE}/${name}`);

  // 1. no external font loading — Inter is self-hosted by the app
  code = code.replace(/@import"https:\/\/fonts\.googleapis\.com[^"]*";/g, '');
  // 2. icon data comes from ./iconify/<prefix>.json instead of the Iconify API
  code = code.replace(/https:\/\/api\.iconify\.design/g, './iconify');
  // 3. wallet/token logos come from ./logos/ instead of remote hosts
  for (const [url, local] of Object.entries(IMAGE_REWRITES)) {
    code = code.replaceAll(url, local);
  }
  // 4. chain-registry data (chain.json / assetlist.json / _IBC pair files, used
  //    by the swap + IBC-send dialogs) comes from ./registry/ instead of
  //    registry.ping.pub (which started returning 403 in Aug 2026). The
  //    "/_IBC/" directory listing becomes a static index.json.
  code = code.replaceAll('https://registry.ping.pub', './registry');
  code = code.replaceAll('get("/_IBC/")', 'get("/_IBC/index.json")');
  // 5. swap assets: allUSDT first (= default) ahead of USDC
  if (code.includes('const tokens = [')) {
    if (!code.includes(TOKENS_ANCHOR)) throw new Error(`${name}: swap tokens list changed upstream — update TOKENS_ANCHOR/TOKENS_PATCHED`);
    code = code.replace(TOKENS_ANCHOR, TOKENS_PATCHED);
  }

  writeFileSync(join(pub, name), code);
  console.log(`${name}: ${code.length} bytes`);

  // follow relative chunk references (static and dynamic imports)
  const refs = [...code.matchAll(/(?:from\s*|import\s*\(?\s*)"\.\/([a-zA-Z0-9_.-]+\.js)"/g)];
  for (const [, ref] of refs) await vendor(ref);
}

await vendor('widget.js');

// download images that aren't already shipped in public/logos/
const { existsSync } = await import('node:fs');
mkdirSync(join(pub, 'logos', 'vendor'), { recursive: true });
for (const [url, local] of Object.entries(IMAGE_REWRITES)) {
  const target = join(pub, local.replace('./', ''));
  if (existsSync(target)) continue;
  const res = await fetch(url);
  if (!res.ok) { console.warn(`WARNING could not download ${url}: HTTP ${res.status}`); continue; }
  writeFileSync(target, Buffer.from(await res.arrayBuffer()));
  console.log(`${local}: downloaded`);
}

// chain-registry data for the swap / IBC dialogs. Only the epix side is needed:
// the widget calls fetchChainInfo/fetchAssetsList with chain-name "epix" and
// looks up the epix<->osmosis pair in the _IBC listing.
const REG = 'https://raw.githubusercontent.com/cosmos/chain-registry/master';
const REG_FILES = ['epix/chain.json', 'epix/assetlist.json', '_IBC/epix-osmosis.json'];
mkdirSync(join(pub, 'registry', 'epix'), { recursive: true });
mkdirSync(join(pub, 'registry', '_IBC'), { recursive: true });
for (const f of REG_FILES) {
  const text = await fetchText(`${REG}/${f}`);
  writeFileSync(join(pub, 'registry', f), text);
  console.log(`registry/${f}: ${text.length} bytes`);
  // vendor images referenced by this registry file (logo_URIs etc.) — the
  // widget rewrites their raw.githubusercontent base to the registry endpoint,
  // which now points at ./registry/, so the same relative layout must exist
  for (const [, imgPath] of text.matchAll(/raw\.githubusercontent\.com\/cosmos\/chain-registry\/master\/([a-zA-Z0-9/_.-]+\.(?:png|svg|jpe?g|webp))/g)) {
    const target = join(pub, 'registry', imgPath);
    mkdirSync(dirname(target), { recursive: true });
    const res = await fetch(`${REG}/${imgPath}`);
    if (!res.ok) { console.warn(`WARNING registry image ${imgPath}: HTTP ${res.status}`); continue; }
    writeFileSync(target, Buffer.from(await res.arrayBuffer()));
    console.log(`registry/${imgPath}: downloaded`);
  }
}
writeFileSync(join(pub, 'registry', '_IBC', 'index.json'),
  JSON.stringify([{ name: 'epix-osmosis.json' }]));

// icons the widget references (grep the downloaded chunks for "mdi:*" / "mdi-*")
const iconNames = new Set();
const { readFileSync } = await import('node:fs');
for (const name of seen) {
  const code = readFileSync(join(pub, name), 'utf8');
  for (const m of code.matchAll(/["'`]mdi[:-]([a-z0-9-]+)["'`]/g)) iconNames.add(m[1]);
}
const list = [...iconNames].sort();
const data = JSON.parse(await fetchText(`https://api.iconify.design/mdi.json?icons=${list.join(',')}`));
if (data.not_found?.length) console.warn('WARNING mdi icons not found:', data.not_found.join(', '));
delete data.not_found;
mkdirSync(join(pub, 'iconify'), { recursive: true });
writeFileSync(join(pub, 'iconify', 'mdi.json'), JSON.stringify(data));
console.log(`iconify/mdi.json: ${list.length} icons (${list.join(', ')})`);
