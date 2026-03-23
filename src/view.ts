import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import type VectorSearchPlugin from "./main";
import { findSimilar, type SimilarNote } from "./vectors";
import { embedQuery, isModelLoading, getStatusMessage } from "./embedder";

export const VIEW_TYPE = "vector-search-sidebar";

export class VectorSearchView extends ItemView {
  plugin: VectorSearchPlugin;
  private searchInput: HTMLInputElement | null = null;
  private resultsContainer: HTMLElement | null = null;
  private statusEl: HTMLElement | null = null;
  private mode: "similar" | "search" = "similar";

  constructor(leaf: WorkspaceLeaf, plugin: VectorSearchPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType(): string {
    return VIEW_TYPE;
  }

  getDisplayText(): string {
    return "Vector Search";
  }

  getIcon(): string {
    return "search";
  }

  async onOpen(): Promise<void> {
    const container = this.containerEl.children[1] as HTMLElement;
    container.empty();
    container.addClass("vector-search-container");

    // Search bar
    const searchWrapper = container.createDiv({ cls: "vector-search-bar" });
    this.searchInput = searchWrapper.createEl("input", {
      type: "text",
      placeholder: "Semantic search...",
      cls: "vector-search-input",
    });
    this.searchInput.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        this.onSearch(this.searchInput!.value);
      }
    });

    const clearBtn = searchWrapper.createDiv({ cls: "vector-search-clear" });
    setIcon(clearBtn, "x");
    clearBtn.addEventListener("click", () => {
      this.searchInput!.value = "";
      this.mode = "similar";
      this.showSimilarToActive();
    });

    // Status
    this.statusEl = container.createDiv({ cls: "vector-search-status" });

    // Results
    this.resultsContainer = container.createDiv({
      cls: "vector-search-results",
    });

    this.showSimilarToActive();
  }

  async onClose(): Promise<void> {}

  showSimilarToActive(): void {
    if (this.mode === "search") return;
    const index = this.plugin.index;
    if (!index) {
      this.setStatus("No embeddings loaded. Run the indexer first.");
      this.clearResults();
      return;
    }

    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      this.setStatus("No active file");
      this.clearResults();
      return;
    }

    const entry = index.notes[activeFile.path];
    if (!entry) {
      this.setStatus(`"${activeFile.basename}" is not indexed`);
      this.clearResults();
      return;
    }

    const similar = findSimilar(
      entry.v,
      index,
      activeFile.path,
      this.plugin.settings.maxResults,
    ).filter((r) => r.score >= this.plugin.settings.minScore);
    this.setStatus(
      `Similar to "${activeFile.basename}" (${Object.keys(index.notes).length} notes indexed)`,
    );
    this.renderResults(similar);
  }

  async onSearch(query: string): Promise<void> {
    if (!query.trim()) {
      this.mode = "similar";
      this.showSimilarToActive();
      return;
    }
    this.mode = "search";
    const index = this.plugin.index;
    if (!index) {
      this.setStatus("No embeddings loaded");
      return;
    }

    const msg = isModelLoading() ? getStatusMessage() || "Loading model..." : "Embedding query...";
    this.setStatus(msg);
    this.clearResults();

    try {
      const queryVec = await embedQuery(query, this.plugin.settings.model);
      const results = findSimilar(
        queryVec,
        index,
        undefined,
        this.plugin.settings.maxResults,
      ).filter((r) => r.score >= this.plugin.settings.minScore);
      this.setStatus(`Results for "${query}"`);
      this.renderResults(results);
    } catch (e: any) {
      this.setStatus(`Error: ${e.message}`);
    }
  }

  private setStatus(text: string): void {
    if (this.statusEl) this.statusEl.textContent = text;
  }

  private clearResults(): void {
    if (this.resultsContainer) this.resultsContainer.empty();
  }

  private renderResults(results: SimilarNote[]): void {
    if (!this.resultsContainer) return;
    this.resultsContainer.empty();

    for (const r of results) {
      const item = this.resultsContainer.createDiv({
        cls: "vector-search-item",
      });

      const body = item.createDiv({ cls: "vector-search-item-body" });
      const titleEl = body.createDiv({ cls: "vector-search-item-title" });
      titleEl.textContent = r.title || r.path;

      const folder = r.path.split("/").slice(0, -1).join("/");
      if (folder) {
        body.createDiv({ text: folder, cls: "vector-search-item-folder" });
      }

      if (this.plugin.settings.showScores) {
        item.createDiv({
          text: `${(r.score * 100).toFixed(0)}%`,
          cls: "vector-search-item-score",
        });
      }

      item.addEventListener("click", () => {
        const file = this.app.vault.getAbstractFileByPath(r.path);
        if (file) {
          this.app.workspace.openLinkText(r.path, "", false);
        }
      });
    }
  }
}
