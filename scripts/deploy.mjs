#!/usr/bin/env node

import { copyFileSync, mkdirSync } from "fs";
import { join } from "path";

const vault = process.argv[2] || process.env.OBSIDIAN_VAULT;
if (!vault) {
  console.error(
    "Usage: node scripts/deploy.mjs <vault-path>\n" +
    "   or: OBSIDIAN_VAULT=<path> npm run deploy\n\n" +
    "Copies built plugin files into the vault's plugin directory.",
  );
  process.exit(1);
}

const dest = join(vault, ".obsidian", "plugins", "obsidian-vector-search");
mkdirSync(dest, { recursive: true });

for (const file of ["main.js", "manifest.json", "styles.css"]) {
  copyFileSync(file, join(dest, file));
  console.log(`  ${file} -> ${dest}/`);
}

console.log("Deployed. Reload Obsidian to pick up changes.");
