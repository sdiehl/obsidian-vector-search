# obsidian-vector-search

[![CI](https://github.com/sdiehl/obsidian-vector-search/actions/workflows/ci.yml/badge.svg)](https://github.com/sdiehl/obsidian-vector-search/actions/workflows/ci.yml)

Semantic similarity sidebar for Obsidian. Shows related notes using vector embeddings. Uses [Orama](https://github.com/oramasearch/orama) under the hood for search.

## Install

```bash
git clone https://github.com/sdiehl/obsidian-vector-search.git
cd obsidian-vector-search
npm install && npm run build   # or: yarn install && yarn build
OBSIDIAN_VAULT=/path/to/vault npm run deploy
```

Enable "Vector Search" in Settings > Community Plugins. The plugin builds the index automatically on first launch. The deploy script also adds the index file to your vault's `.gitignore`.

Re-run `npm run deploy` after pulling updates.

### iOS / iPad

Set indexing mode to **Read-only (iPad mode)** in Settings > Vector Search. The index syncs from your Mac via Obsidian Sync or iCloud. The sidebar works instantly. Ad-hoc search downloads the embedding model (~23MB) on first use, cached after that.

## Usage

Open the sidebar via the ribbon icon or `Cmd+P` > "Open vector search sidebar".

- **Similar notes**: Navigate to any note to see semantically related notes ranked by similarity.
- **Semantic search**: Type a query in the search bar and press Enter.
- **Auto-indexing**: Notes are re-indexed on save. New and renamed notes are indexed automatically.
- **Rebuild**: Use Settings > Vector Search > Rebuild to re-index the entire vault.

## License

MIT
