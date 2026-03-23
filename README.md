# obsidian-vector-search

[![CI](https://github.com/sdiehl/obsidian-vector-search/actions/workflows/ci.yml/badge.svg)](https://github.com/sdiehl/obsidian-vector-search/actions/workflows/ci.yml)

Semantic similarity sidebar for Obsidian. Sidebar for related notes using vector embeddings.

## Install

### Desktop (Mac/Linux/Windows)

```bash
git clone https://github.com/sdiehl/obsidian-vector-search.git
cd obsidian-vector-search
npm install && npm run build   # or: yarn install && yarn build
```

Symlink into your vault:

```bash
ln -s "$(pwd)" /path/to/vault/.obsidian/plugins/obsidian-vector-search
```

Enable "Vector Search" in Settings > Community Plugins. The plugin automatically builds the index on first launch and keeps it updated as you edit notes.

### iPad

Set indexing mode to **Read-only (iPad mode)** in Settings > Vector Search. The index file syncs from your Mac via Obsidian Sync or iCloud. The sidebar shows similar notes instantly. Ad-hoc search downloads the embedding model (~23MB) on first use, cached after that.

## Usage

Open the sidebar via the ribbon icon or `Cmd+P` > "Open vector search sidebar". Navigate to any note to see semantically similar notes ranked by cosine similarity. Type a query in the search bar for ad-hoc semantic search.

## CLI indexer (optional)

For power users who prefer CLI-based indexing:

```bash
node scripts/index.mjs --vault <path> [options]

  --model <id>            Embedding model (default: Xenova/all-MiniLM-L6-v2)
  --exclude <dirs>        Comma-separated folders to skip (default: daily,scratch,templates)
  --truncate <n>          Max chars per note (default: 2000)
  --output <path>         Custom output path for embeddings.json
  --no-frontmatter        Strip frontmatter tags from embedded text
  --title-weight <n>      Prepend title N times (default: 1, 0 to disable)
  --include-path          Prepend file path to content
  --min-length <n>        Skip notes shorter than N chars (default: 20)
```

## License

MIT
