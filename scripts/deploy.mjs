#!/usr/bin/env node

import { copyFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "fs";
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

const dest = join(vault, ".obsidian", "plugins", "vector-search");
mkdirSync(dest, { recursive: true });

for (const file of ["main.js", "manifest.json", "styles.css"]) {
  copyFileSync(file, join(dest, file));
  console.log(`  ${file} -> ${dest}/`);
}

// Add embeddings.json to vault .gitignore if not already present
const gitignorePath = join(vault, ".gitignore");
const ignoreEntry = ".obsidian/plugins/vector-search/embeddings.json";
if (existsSync(gitignorePath)) {
  const content = readFileSync(gitignorePath, "utf-8");
  if (!content.includes(ignoreEntry)) {
    writeFileSync(gitignorePath, content.trimEnd() + "\n" + ignoreEntry + "\n");
    console.log("  Added embeddings.json to vault .gitignore");
  }
} else if (existsSync(join(vault, ".git"))) {
  writeFileSync(gitignorePath, ignoreEntry + "\n");
  console.log("  Created vault .gitignore with embeddings.json entry");
}

console.log("Deployed. Reload Obsidian to pick up changes.");
