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

function hasFlag(name) {
  return process.argv.includes(name);
}

const vaultPath = getArg("--vault", null);
if (!vaultPath) {
  console.error(
    "Usage: node scripts/index.mjs --vault <path> [options]\n\n" +
    "Options:\n" +
    "  --model <id>            Embedding model (default: Xenova/all-MiniLM-L6-v2)\n" +
    "  --exclude <dirs>        Comma-separated folders to skip (default: daily,scratch,templates)\n" +
    "  --truncate <n>          Max chars per note (default: 2000)\n" +
    "  --output <path>         Custom output path for embeddings.json\n" +
    "  --include-frontmatter   Include YAML tags in embedded text (default: on)\n" +
    "  --no-frontmatter        Strip frontmatter tags from embedded text\n" +
    "  --title-weight <n>      Prepend title N times (default: 1, 0 to disable)\n" +
    "  --include-path          Prepend file path to content\n" +
    "  --min-length <n>        Skip notes shorter than N chars (default: 20)",
  );
  process.exit(1);
}

const MODEL = getArg("--model", "Xenova/all-MiniLM-L6-v2");
const TRUNCATE = parseInt(getArg("--truncate", "2000"), 10);
const EXCLUDE_ARG = getArg("--exclude", "daily,scratch,templates");
const OUTPUT_ARG = getArg("--output", null);
const INCLUDE_FRONTMATTER = !hasFlag("--no-frontmatter");
const TITLE_WEIGHT = parseInt(getArg("--title-weight", "1"), 10);
const INCLUDE_PATH = hasFlag("--include-path");
const MIN_LENGTH = parseInt(getArg("--min-length", "20"), 10);

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

function prepareContent(raw, filePath) {
  let body = raw;
  let tags = [];

  // Parse and strip frontmatter
  if (raw.startsWith("---")) {
    const end = raw.indexOf("---", 3);
    if (end !== -1) {
      const fm = raw.slice(3, end);
      body = raw.slice(end + 3).trim();
      // Extract tags
      const tagMatch = fm.match(/^tags:\s*\[([^\]]*)\]/m);
      if (tagMatch) {
        tags = tagMatch[1].split(",").map((t) => t.trim()).filter(Boolean);
      } else {
        const lines = fm.split("\n");
        let inTags = false;
        for (const line of lines) {
          if (/^tags:\s*$/.test(line)) {
            inTags = true;
          } else if (inTags && /^\s+-\s+(.+)/.test(line)) {
            const m = line.match(/^\s+-\s+(.+)/);
            if (m) tags.push(m[1].trim());
          } else if (inTags && !/^\s*$/.test(line)) {
            inTags = false;
          }
        }
      }
    }
  }

  // Extract title
  const titleMatch = body.match(/^#\s+(.+)$/m);
  const title = titleMatch
    ? titleMatch[1].trim()
    : basename(filePath, ".md").replace(/-/g, " ");

  // Build embedding input
  let prefix = "";
  if (INCLUDE_PATH) {
    const pathWithoutExt = filePath.replace(/\.md$/, "");
    prefix += `path: ${pathWithoutExt}\n`;
  }
  for (let i = 0; i < TITLE_WEIGHT; i++) {
    prefix += title + "\n";
  }
  if (INCLUDE_FRONTMATTER && tags.length > 0) {
    prefix += "tags: " + tags.join(", ") + "\n";
  }

  return { text: prefix + body, title };
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

console.log(`Vault:       ${vaultPath}`);
console.log(`Model:       ${MODEL}`);
console.log(`Truncate:    ${TRUNCATE} chars`);
console.log(`Frontmatter: ${INCLUDE_FRONTMATTER ? "included" : "stripped"}`);
console.log(`Title weight: ${TITLE_WEIGHT}`);
console.log(`Include path: ${INCLUDE_PATH}`);
console.log(`Min length:  ${MIN_LENGTH}`);
console.log(`Exclude:     ${[...SKIP_DIRS].join(", ")}`);
console.log(`Output:      ${OUTPUT}\n`);

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
  const { text, title } = prepareContent(raw, relPath);

  if (text.length < MIN_LENGTH) {
    skipped++;
    continue;
  }

  const truncated = text.slice(0, TRUNCATE);
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
