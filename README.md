# obsidian-vector-search

Semantic similarity sidebar for Obsidian. Precompute embeddings on your computer, view similar notes everywhere (including iPad).

1. An indexer script embeds all notes using `all-MiniLM-L6-v2` (384-dim, quantized) and writes a vector index file.
2. The plugin loads the index and shows semantically similar notes in a sidebar.
3. A search bar allows ad-hoc semantic queries (loads the model lazily on first use).

The sidebar is pure cosine similarity against precomputed vectors. No ML model needed for that part. Fast on any device.

## Install

### From source

```bash
git clone https://github.com/sdiehl/obsidian-vector-search.git
cd obsidian-vector-search
npm install
npm run build
```

Copy or symlink into your vault:

```bash
ln -s /path/to/obsidian-vector-search /path/to/vault/.obsidian/plugins/obsidian-vector-search
```

Enable "Vector Search" in Obsidian Settings > Community Plugins.

### Build the index

```bash
node scripts/index.mjs --vault /path/to/vault
```

This writes `embeddings.json` into the plugin directory. Re-run after adding or editing notes. Incremental: skips unchanged files.

## Usage

- Open the sidebar via the ribbon icon or Command Palette ("Open vector search sidebar").
- Navigate to any note to see similar notes ranked by cosine similarity.
- Type a query in the search bar and press Enter for ad-hoc semantic search.

First search query downloads the embedding model (~23MB, cached after that).

## iPad

The `embeddings.json` file syncs via Obsidian Sync or iCloud. The sidebar works instantly (just math). Search queries require a one-time model download.
