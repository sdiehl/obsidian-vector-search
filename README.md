# obsidian-vector-search

[![CI](https://github.com/sdiehl/obsidian-vector-search/actions/workflows/ci.yml/badge.svg)](https://github.com/sdiehl/obsidian-vector-search/actions/workflows/ci.yml)

Semantic similarity sidebar for Obsidian. Shows related notes using vector embeddings. Uses [Orama](https://github.com/oramasearch/orama) under the hood for search.

## Install

### Download release

Download `obsidian-vector-search.zip` from the [latest release](https://github.com/sdiehl/obsidian-vector-search/releases/latest), unzip it into your vault's `.obsidian/plugins/` folder, and enable "Vector Search" in Settings > Community Plugins.

### BRAT

Install [BRAT](https://github.com/TfTHacker/obsidian42-brat), then add `sdiehl/obsidian-vector-search` as a beta plugin.

### From source

```bash
git clone https://github.com/sdiehl/obsidian-vector-search.git
cd obsidian-vector-search
npm install && npm run build
OBSIDIAN_VAULT=/path/to/vault npm run deploy
```

Re-run `npm run deploy` after pulling updates. The deploy script also adds the index file to your vault's `.gitignore`.

### iOS / iPad

Set indexing mode to **Read-only (iPad mode)** in Settings > Vector Search. The index syncs from your Mac via Obsidian Sync or iCloud. The sidebar works instantly. Ad-hoc search downloads the embedding model (~23MB) on first use, cached after that.

## Usage

Open the sidebar via the ribbon icon or `Cmd+P` > "Open vector search sidebar".

- **Similar notes**: Navigate to any note to see semantically related notes ranked by similarity.
- **Semantic search**: Type a query in the search bar and press Enter.
- **Auto-indexing**: Notes are re-indexed on save. New and renamed notes are indexed automatically.
- **Rebuild**: Use Settings > Vector Search > Rebuild to re-index the entire vault.

## Embeddings

Embeddings are computed via [Transformers.js](https://github.com/huggingface/transformers.js) running ONNX models in a sandboxed iframe using the WebAssembly backend (no native dependencies, works on desktop and iPad).

| Model                        | Dimensions | Quantization | Download | RAM   |
| ---------------------------- | ---------- | ------------ | -------- | ----- |
| `all-MiniLM-L6-v2` (default) | 384        | INT8         | ~23MB    | ~50MB |
| `all-MiniLM-L12-v2`          | 384        | INT8         | ~33MB    | ~70MB |
| `bge-small-en-v1.5`          | 384        | INT8         | ~33MB    | ~70MB |

WebGPU acceleration is used when available (Chrome/Edge on supported hardware). Falls back to WASM single-threaded on iPad and environments without SharedArrayBuffer. Model files are downloaded from HuggingFace on first use and cached in IndexedDB.

## License

MIT
