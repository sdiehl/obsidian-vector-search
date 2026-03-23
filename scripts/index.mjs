#!/usr/bin/env node

import { pipeline } from "@huggingface/transformers";
import { readdir, readFile, stat, writeFile, mkdir } from "fs/promises";
import { join, relative, extname, basename } from "path";

const args = process.argv.slice(2);
const vaultIdx = args.indexOf("--vault");
if (vaultIdx === -1 || !args[vaultIdx + 1]) {
  console.error("Usage: node scripts/index.mjs --vault <path-to-vault>");
  process.exit(1);
}
const vaultPath = args[vaultIdx + 1];

const MODEL = "Xenova/all-MiniLM-L6-v2";
const PLUGIN_DIR = join(
  vaultPath,
  ".obsidian",
  "plugins",
  "obsidian-vector-search",
);
const OUTPUT = join(PLUGIN_DIR, "embeddings.json");
const SKIP_DIRS = new Set([".obsidian", ".git", "node_modules", ".trash"]);

async function collectMdFiles(dir, root) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectMdFiles(full, root)));
    } else if (extname(entry.name) === ".md" && entry.name !== "template.md") {
      files.push(full);
    }
  }
  return files;
}

function stripFrontmatter(content) {
  if (!content.startsWith("---")) return content;
  const end = content.indexOf("---", 3);
  if (end === -1) return content;
  return content.slice(end + 3).trim();
}

function extractTitle(content, filename) {
  const match = content.match(/^#\s+(.+)$/m);
  if (match) return match[1].trim();
  return basename(filename, ".md").replace(/-/g, " ");
}

// Load existing index for incremental updates
let existing = { notes: {} };
try {
  const raw = await readFile(OUTPUT, "utf-8");
  existing = JSON.parse(raw);
  console.log(
    `Loaded existing index with ${Object.keys(existing.notes).length} notes`,
  );
} catch {
  // No existing index
}

console.log(`Indexing vault: ${vaultPath}`);
console.log(`Loading model: ${MODEL}`);

const embedder = await pipeline("feature-extraction", MODEL, { dtype: "q8" });

const mdFiles = await collectMdFiles(vaultPath, vaultPath);
console.log(`Found ${mdFiles.length} markdown files`);

const notes = {};
let skipped = 0;
let embedded = 0;

for (const file of mdFiles) {
  const relPath = relative(vaultPath, file);
  const fileStat = await stat(file);
  const mtime = Math.floor(fileStat.mtimeMs / 1000);

  // Skip if unchanged
  if (existing.notes[relPath] && existing.notes[relPath].mtime === mtime) {
    notes[relPath] = existing.notes[relPath];
    skipped++;
    continue;
  }

  const raw = await readFile(file, "utf-8");
  const content = stripFrontmatter(raw);
  if (content.length < 20) {
    skipped++;
    continue;
  }

  const title = extractTitle(content, file);
  // Truncate to ~512 tokens worth of text (~2000 chars)
  const truncated = content.slice(0, 2000);

  const output = await embedder(truncated, {
    pooling: "mean",
    normalize: true,
  });
  const v = Array.from(output.data);

  notes[relPath] = { v, title, mtime };
  embedded++;
  process.stdout.write(`\r  Embedded ${embedded} / ${mdFiles.length - skipped} notes`);
}

console.log(
  `\nDone: ${embedded} embedded, ${skipped} skipped (unchanged or too short)`,
);

const index = {
  model: MODEL,
  dimension: 384,
  indexed_at: new Date().toISOString(),
  notes,
};

await mkdir(PLUGIN_DIR, { recursive: true });
await writeFile(OUTPUT, JSON.stringify(index));
const sizeKB = (JSON.stringify(index).length / 1024).toFixed(1);
console.log(`Wrote ${OUTPUT} (${sizeKB} KB, ${Object.keys(notes).length} notes)`);
