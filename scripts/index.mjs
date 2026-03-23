#!/usr/bin/env node

import { pipeline } from "@huggingface/transformers";
import { readdir, readFile, stat, writeFile, mkdir } from "fs/promises";
import { join, relative, extname, basename } from "path";

function getArg(name, fallback) {
  const idx = process.argv.indexOf(name);
  return idx !== -1 && process.argv[idx + 1]
    ? process.argv[idx + 1]
    : fallback;
}

const vaultPath = getArg("--vault", null);
if (!vaultPath) {
  console.error(
    "Usage: node scripts/index.mjs --vault <path> [--model <model>] [--exclude <folders>] [--truncate <chars>] [--output <path>]",
  );
  process.exit(1);
}

const MODEL = getArg("--model", "Xenova/all-MiniLM-L6-v2");
const TRUNCATE = parseInt(getArg("--truncate", "2000"), 10);
const EXCLUDE_ARG = getArg("--exclude", "daily,scratch,templates");
const OUTPUT_ARG = getArg("--output", null);

const PLUGIN_DIR = join(
  vaultPath,
  ".obsidian",
  "plugins",
  "obsidian-vector-search",
);
const OUTPUT = OUTPUT_ARG || join(PLUGIN_DIR, "embeddings.json");

const SKIP_DIRS = new Set([
  ".obsidian",
  ".git",
  "node_modules",
  ".trash",
  ...EXCLUDE_ARG.split(",").map((s) => s.trim()).filter(Boolean),
]);

async function collectMdFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectMdFiles(full)));
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

console.log(`Vault:    ${vaultPath}`);
console.log(`Model:    ${MODEL}`);
console.log(`Truncate: ${TRUNCATE} chars`);
console.log(`Exclude:  ${[...SKIP_DIRS].join(", ")}`);
console.log(`Output:   ${OUTPUT}\n`);

const embedder = await pipeline("feature-extraction", MODEL, { dtype: "q8" });

const mdFiles = await collectMdFiles(vaultPath);
console.log(`Found ${mdFiles.length} markdown files`);

const notes = {};
let skipped = 0;
let embedded = 0;

for (const file of mdFiles) {
  const relPath = relative(vaultPath, file);
  const fileStat = await stat(file);
  const mtime = Math.floor(fileStat.mtimeMs / 1000);

  // Skip if unchanged and same model
  if (
    existing.notes[relPath] &&
    existing.notes[relPath].mtime === mtime &&
    existing.model === MODEL
  ) {
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
  const truncated = content.slice(0, TRUNCATE);

  const output = await embedder(truncated, {
    pooling: "mean",
    normalize: true,
  });
  const v = Array.from(output.data);

  notes[relPath] = { v, title, mtime };
  embedded++;
  process.stdout.write(
    `\r  Embedded ${embedded} / ${mdFiles.length - skipped} notes`,
  );
}

console.log(
  `\nDone: ${embedded} embedded, ${skipped} skipped (unchanged or too short)`,
);

const dims = Object.values(notes)[0]?.v?.length || 384;
const index = {
  model: MODEL,
  dimension: dims,
  indexed_at: new Date().toISOString(),
  notes,
};

const outputDir = OUTPUT.substring(0, OUTPUT.lastIndexOf("/"));
await mkdir(outputDir, { recursive: true });
await writeFile(OUTPUT, JSON.stringify(index));
const sizeKB = (JSON.stringify(index).length / 1024).toFixed(1);
console.log(
  `Wrote ${OUTPUT} (${sizeKB} KB, ${Object.keys(notes).length} notes)`,
);
