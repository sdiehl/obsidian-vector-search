# Vector Search

[![CI](https://github.com/sdiehl/obsidian-vector-search/actions/workflows/ci.yml/badge.svg)](https://github.com/sdiehl/obsidian-vector-search/actions/workflows/ci.yml)

Semantic similarity search for Obsidian vaults using only on-device vector embeddings. Find related notes automatically as you browse, or run ad-hoc hybrid queries from the sidebar. Everything runs locally with no API keys or cloud services required.

Uses [Orama](https://github.com/oramasearch/orama) for hybrid full-text + vector search and [Transformers.js](https://github.com/huggingface/transformers.js) for on-device embeddings.

## Install

### From Community Plugins

1. Open Settings > Community Plugins
2. Search for "Vector Search"
3. Install and enable

### Download Release

Download `vector-search.zip` from the [latest release](https://github.com/sdiehl/obsidian-vector-search/releases/latest), unzip it into your vault's `.obsidian/plugins/` folder, and enable "Vector Search" in Settings > Community Plugins.

### BRAT

Install [BRAT](https://github.com/TfTHacker/obsidian42-brat), then add `sdiehl/obsidian-vector-search` as a beta plugin.

### From Source

```bash
git clone https://github.com/sdiehl/obsidian-vector-search.git
cd obsidian-vector-search
npm install && npm run build
OBSIDIAN_VAULT=/path/to/vault npm run deploy
```

Re-run `npm run deploy` after pulling updates. The deploy script also adds the index file to your vault's `.gitignore`.

## Usage

Open the sidebar via the ribbon icon or `Cmd+P` > "Open vector search sidebar".

- **Similar notes**: Navigate to any note to see semantically related notes ranked by similarity.
- **Hybrid search**: Type a query in the search bar and press Enter. Combines keyword matching with semantic similarity for accurate results. The balance between keyword and semantic scoring is configurable.
- **Auto-indexing**: Notes are re-indexed on save. New and renamed notes are indexed automatically.
- **Rebuild**: Use Settings > Vector Search > Rebuild to re-index the entire vault.

### Indexing Modes

| Mode      | Behavior                                             |
| --------- | ---------------------------------------------------- |
| On save   | Re-embeds notes when you navigate away after editing |
| Interval  | Periodic full re-index at a configurable interval    |
| Manual    | Only indexes when you click "Rebuild" in settings    |
| Read-only | Uses a pre-built index, no writes (for iPad/mobile)  |

### iPad / Mobile Setup

1. Build the index on desktop (or use the CLI: `node scripts/index.mjs --vault /path/to/vault`)
2. Sync the index file via Obsidian Sync or iCloud
3. On iPad, set indexing mode to **Read-only** and enable **Low memory mode**

Low memory mode skips caching vectors in RAM (Orama handles storage internally), roughly halving memory usage. The similar-notes view will embed the active note on each switch instead of using a cached vector.

## Embeddings

Embeddings are computed via [Transformers.js](https://github.com/huggingface/transformers.js) running ONNX models in a sandboxed iframe using the WebAssembly backend (no native dependencies, works on desktop and iPad).

| Model                        | Dimensions | Quantization | Download | RAM    |
| ---------------------------- | ---------- | ------------ | -------- | ------ |
| `all-MiniLM-L6-v2` (default) | 384        | INT8         | ~23 MB   | ~50 MB |
| `all-MiniLM-L12-v2`          | 384        | INT8         | ~33 MB   | ~70 MB |
| `bge-small-en-v1.5`          | 384        | INT8         | ~33 MB   | ~70 MB |

Model files are downloaded from HuggingFace on first use and cached in IndexedDB. WebGPU acceleration is used when available. Falls back to WASM single-threaded on iPad and environments without SharedArrayBuffer.

## CLI Indexing

Pre-index a vault from the command line (useful for large vaults or iPad sync):

```bash
node scripts/index.mjs --vault /path/to/vault
```

## Releasing

```bash
node scripts/release.mjs 0.3.0
```

## License

[MIT](LICENSE)
