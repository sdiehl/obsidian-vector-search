# obsidian-vector-search

[![CI](https://github.com/sdiehl/obsidian-vector-search/actions/workflows/ci.yml/badge.svg)](https://github.com/sdiehl/obsidian-vector-search/actions/workflows/ci.yml)

Semantic similarity sidebar for Obsidian. Precomputes note embeddings on your computer, shows similar notes everywhere including iPad.

## Install

```bash
git clone https://github.com/sdiehl/obsidian-vector-search.git
cd obsidian-vector-search

# npm
npm install && npm run build

# or yarn
yarn install && yarn build
```

Symlink into your vault:

```bash
ln -s "$(pwd)" /path/to/vault/.obsidian/plugins/obsidian-vector-search
```

Enable "Vector Search" in Settings > Community Plugins.

## Usage

Open the sidebar via the ribbon icon or `Cmd+P` > "Open vector search sidebar". Navigate to any note to see semantically similar notes. Type a query in the search bar for ad-hoc semantic search.

Notes are automatically re-embedded when modified (10s debounce). First search downloads the embedding model (~23MB, cached after that).

### Initial index

For the first run, build the full index from the CLI:

```bash
# npm
npm run index -- --vault /path/to/vault

# or yarn
yarn index --vault /path/to/vault
```

After that, the plugin auto-indexes on file changes. You can also trigger a full re-index from the command palette: "Re-embed all notes now".

### Background watcher (optional)

If you prefer CLI-based indexing over in-plugin auto-indexing:

```bash
npm run watch-vault -- --vault /path/to/vault
```

Re-indexes changed files every 60 seconds.

## Settings

Configure via Settings > Vector Search:

| Setting | Default | Description |
|---|---|---|
| Embedding model | MiniLM-L6 | Model for query embedding. Options: MiniLM-L6 (fast, 23MB), MiniLM-L12 (more accurate, 33MB), BGE Small (BAAI, 33MB) |
| Max results | 20 | Number of similar notes shown |
| Min similarity | 0.1 | Cosine similarity threshold (0.0-1.0) |
| Show scores | on | Display percentage scores in results |
| Index path | (plugin dir) | Custom location for embeddings.json |
| Exclude folders | daily, scratch, templates | Folders to skip during indexing |
| Truncation length | 2000 | Max chars per note to embed |

## CLI indexer options

```bash
node scripts/index.mjs --vault <path> [options]

  --model <id>       Embedding model (default: Xenova/all-MiniLM-L6-v2)
  --exclude <dirs>   Comma-separated folders to skip (default: daily,scratch,templates)
  --truncate <n>     Max chars to embed per note (default: 2000)
  --output <path>    Custom output path for embeddings.json
```

Indexing is incremental. Unchanged files (same mtime) are skipped. Changing `--model` forces a full re-embed.

## iPad

`embeddings.json` syncs via Obsidian Sync or iCloud. The sidebar computes cosine similarity in pure JS. No model needed for the "similar notes" view. Search queries download the model on first use (~23MB, cached in IndexedDB).

## Architecture

```
scripts/index.mjs    CLI indexer (Node.js, uses @huggingface/transformers)
src/main.ts          Plugin entry, settings, auto-indexing on file changes
src/view.ts          Sidebar view (ItemView) with search bar and results
src/embedder.ts      Lazy model loading for query embedding
src/vectors.ts       Cosine similarity and index types
src/settings.ts      Settings tab with model selection and tuning
```

Embeddings are stored in `embeddings.json` (one vector per note, 384 dimensions). For 100 notes this is ~1MB. The sidebar does brute-force cosine similarity which is instant for vaults under 10k notes.

## License

MIT
