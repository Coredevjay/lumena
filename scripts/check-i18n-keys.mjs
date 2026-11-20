#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const source = readFileSync(
  join(root, "packages/react/src/i18n/translations.ts"),
  "utf8",
);
const localeBlocks = [...source.matchAll(/const (\w+): LumenTranslations/g)].map((m) => m[1]);
const locales = localeBlocks.filter((id) => id !== "en");

function keysForLocale(localeId) {
  const block = source.match(new RegExp(`const ${localeId}: LumenTranslations = ([\\s\\S]*?);\\n`));
  if (!block) return [];
  return [...block[1].matchAll(/^\s+(\w+):/gm)].map((m) => m[1]);
}

const enKeys = keysForLocale("en");
let failed = false;

for (const locale of locales) {
  const keys = keysForLocale(locale);
  const missing = enKeys.filter((k) => !keys.includes(k));
  if (missing.length) {
    console.error(`Locale ${locale} missing keys: ${missing.join(", ")}`);
    failed = true;
  }
}

if (failed) process.exit(1);
console.log("All translation locales have matching top-level keys.");