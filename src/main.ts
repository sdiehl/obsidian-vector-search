import { Plugin, WorkspaceLeaf } from "obsidian";
import { VectorSearchView, VIEW_TYPE } from "./view";
import type { EmbeddingsIndex } from "./vectors";

const EMBEDDINGS_FILE = "embeddings.json";

export default class VectorSearchPlugin extends Plugin {
  index: EmbeddingsIndex | null = null;

  async onload(): Promise<void> {
    await this.loadIndex();

    this.registerView(VIEW_TYPE, (leaf: WorkspaceLeaf) => {
      return new VectorSearchView(leaf, this);
    });

    this.addRibbonIcon("search", "Vector Search", () => {
      this.activateView();
    });

    this.addCommand({
      id: "open-vector-search",
      name: "Open vector search sidebar",
      callback: () => this.activateView(),
    });

    this.addCommand({
      id: "reindex",
      name: "Reload embeddings index",
      callback: () => this.loadIndex(),
    });

    // Update sidebar when active file changes
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        const view = this.getView();
        if (view) view.showSimilarToActive();
      }),
    );
  }

  async onunload(): Promise<void> {}

  async loadIndex(): Promise<void> {
    try {
      const path = `${this.manifest.dir}/${EMBEDDINGS_FILE}`;
      const adapter = this.app.vault.adapter;
      if (await adapter.exists(path)) {
        const raw = await adapter.read(path);
        this.index = JSON.parse(raw) as EmbeddingsIndex;
        console.log(
          `Vector Search: loaded ${Object.keys(this.index.notes).length} note embeddings`,
        );
      } else {
        console.log("Vector Search: no embeddings.json found");
      }
    } catch (e) {
      console.error("Vector Search: failed to load index", e);
    }
  }

  getView(): VectorSearchView | null {
    const leaves = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    if (leaves.length > 0) {
      return leaves[0].view as VectorSearchView;
    }
    return null;
  }

  async activateView(): Promise<void> {
    const existing = this.app.workspace.getLeavesOfType(VIEW_TYPE);
    if (existing.length > 0) {
      this.app.workspace.revealLeaf(existing[0]);
      return;
    }
    const leaf = this.app.workspace.getRightLeaf(false);
    if (leaf) {
      await leaf.setViewState({ type: VIEW_TYPE, active: true });
      this.app.workspace.revealLeaf(leaf);
    }
  }
}
