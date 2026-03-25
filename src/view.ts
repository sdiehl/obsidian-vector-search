import { ItemView, WorkspaceLeaf, setIcon } from "obsidian";
import type VectorSearchPlugin from "./main";
import { embedQuery, isModelLoading, getStatusMessage } from "./embedder";

export const VIEW_TYPE = "vector-search-sidebar";

interface ResultItem {
  path: string;
  title: string;
  score: number;
}

export class VectorSearchView extends ItemView {
  plugin: VectorSearchPlugin;
  navigation = false;
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

    const searchWrapper = container.createDiv({ cls: "vector-search-bar" });
    this.searchInput = searchWrapper.createEl("input", {
      type: "text",
      placeholder: "Semantic search...",
      cls: "vector-search-input",
    });
    this.searchInput.addEventListener("keydown", (e: KeyboardEvent) => {
      if (e.key === "Enter") {
        void this.onSearch(this.searchInput!.value);
      }
    });

    const clearBtn = searchWrapper.createDiv({ cls: "vector-search-clear" });
    setIcon(clearBtn, "x");
    clearBtn.addEventListener("click", () => {
      this.searchInput!.value = "";
      this.mode = "similar";
      this.showSimilarToActive();
    });

    this.statusEl = container.createDiv({ cls: "vector-search-status" });

    this.resultsContainer = container.createDiv({
      cls: "vector-search-results",
    });

    this.resultsContainer.addEventListener("mousedown", (e: MouseEvent) => {
      if (!(e.target instanceof HTMLInputElement)) {
        e.preventDefault();
      }
    });

    this.showSimilarToActive();
  }

  async onClose(): Promise<void> {}

  forceShowSimilar(): void {
    this.mode = "similar";
    this.showSimilarToActive();
  }

  showSimilarToActive(): void {
    if (this.mode === "search") return;

    // Clear stale results immediately so the old highlight doesn't linger
    this.clearResults();

    const activeFile = this.app.workspace.getActiveFile();
    if (!activeFile) {
      this.setStatus("Open a note to see similar notes");
      return;
    }

    this.setStatus("Loading...");
    this.doShowSimilar(activeFile.path, activeFile.basename).catch((e) =>
      console.error("Vector Search: sidebar error", e),
    );
  }

  private async doShowSimilar(path: string, basename: string): Promise<void> {
    const n = this.plugin.getNoteCount();
    if (n === 0) {
      this.setStatus("No embeddings loaded.");
      this.clearResults();
      return;
    }

    let vec = this.plugin.getNoteVector(path);

    // In low memory mode, embed the active note on the fly
    if (!vec && this.plugin.settings.lowMemory) {
      const msg = isModelLoading()
        ? getStatusMessage() || "Loading model..."
        : `Embedding "${basename}"...`;
      this.setStatus(msg);
      try {
        vec = await this.plugin.getActiveNoteEmbedding(path);
      } catch {
        // Fall through to not-indexed state
      }
    }

    if (!vec) {
      const excluded = this.plugin.isFileExcluded(path);
      if (excluded) {
        this.setStatus(`"${basename}" is in excluded folder "${excluded}"`);
        this.clearResults();
        return;
      }
      // Auto-index this note immediately instead of showing "not indexed"
      if (
        this.plugin.settings.indexMode !== "readonly" &&
        this.plugin.settings.indexMode !== "manual"
      ) {
        this.setStatus(`Indexing "${basename}"...`);
        this.clearResults();
        try {
          await this.plugin.indexSingleNote(path);
          vec = this.plugin.getNoteVector(path);
        } catch {
          // Fall through to not-indexed state
        }
      }
      if (!vec) {
        this.setStatus(
          `"${basename}" is not indexed (content may be too short, min ${this.plugin.settings.minContentLength} chars)`,
        );
        this.clearResults();
        this.showRebuildButton();
        return;
      }
    }

    const similar = this.plugin.findSimilarNotes(vec, path);
    this.setStatus(`Similar to "${basename}" (${n} notes indexed)`);
    this.renderResults(similar);
  }

  async onSearch(query: string): Promise<void> {
    if (!query.trim()) {
      this.mode = "similar";
      this.showSimilarToActive();
      return;
    }
    this.mode = "search";

    const n = this.plugin.getNoteCount();
    if (n === 0) {
      this.setStatus("No embeddings loaded");
      return;
    }

    const msg = isModelLoading() ? getStatusMessage() || "Loading model..." : "Embedding query...";
    this.setStatus(msg);
    this.clearResults();

    try {
      const queryVec = await embedQuery(query, this.plugin.settings.model);
      const results = this.plugin.findHybridNotes(queryVec, query);
      this.setStatus(`Results for "${query}"`);
      this.renderResults(results);
    } catch (e: any) {
      this.setStatus(`Error: ${e.message}`);
    }
  }

  setIndexingStatus(text: string): void {
    this.setStatus(text);
    if (text) {
      this.clearResults();
    }
  }

  private setStatus(text: string): void {
    if (this.statusEl) this.statusEl.textContent = text;
  }

  private clearResults(): void {
    if (this.resultsContainer) this.resultsContainer.empty();
  }

  private showRebuildButton(): void {
    if (!this.resultsContainer || this.plugin.settings.indexMode === "readonly") return;
    const btn = this.resultsContainer.createEl("button", {
      text: "Rebuild Index",
      cls: "vector-search-rebuild-btn",
    });
    btn.addEventListener("click", () => {
      btn.disabled = true;
      btn.textContent = "Indexing...";
      this.mode = "similar";
      void this.plugin.rebuildIndex();
    });
  }

  private renderResults(results: ResultItem[]): void {
    if (!this.resultsContainer) return;
    this.resultsContainer.empty();

    for (const r of results) {
      const item = this.resultsContainer.createDiv({
        cls: "vector-search-item",
      });

      const body = item.createDiv({ cls: "vector-search-item-body" });
      const titleEl = body.createDiv({ cls: "vector-search-item-title" });
      titleEl.textContent = r.title || r.path;

      const folder = r.path.split("/").slice(0, -1).join("/") || "/";
      body.createDiv({ text: folder, cls: "vector-search-item-folder" });

      if (this.plugin.settings.showScores) {
        item.createDiv({
          text: `${(r.score * 100).toFixed(0)}%`,
          cls: "vector-search-item-score",
        });
      }

      item.addEventListener("auxclick", (e: MouseEvent) => {
        if (e.button === 1) {
          void this.app.workspace.openLinkText(r.path, "", "tab");
        }
      });
      item.addEventListener("pointerdown", (e: PointerEvent) => {
        if (e.button !== 0) return;
        e.preventDefault();
        void this.app.workspace.openLinkText(r.path, "", false);
      });
    }
  }
}
