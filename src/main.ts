import { Plugin, TFile, WorkspaceLeaf, debounce } from "obsidian";
import { VectorSearchView, VIEW_TYPE } from "./view";
import type { EmbeddingsIndex } from "./vectors";
import { resetEmbedder, embedQuery } from "./embedder";
import {
  VectorSearchSettingTab,
  DEFAULT_SETTINGS,
  type VectorSearchSettings,
} from "./settings";

const EMBEDDINGS_FILE = "embeddings.json";

export default class VectorSearchPlugin extends Plugin {
  index: EmbeddingsIndex | null = null;
  settings: VectorSearchSettings = DEFAULT_SETTINGS;
  private pendingFiles: Set<string> = new Set();
  private flushPending: () => void;

  constructor(app: any, manifest: any) {
    super(app, manifest);
    this.flushPending = debounce(() => this.reindexPending(), 10_000, true);
  }

  async onload(): Promise<void> {
    await this.loadSettings();
    await this.loadIndex();

    this.addSettingTab(new VectorSearchSettingTab(this.app, this));

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

    this.addCommand({
      id: "reindex-all",
      name: "Re-embed all notes now",
      callback: () => this.reindexAll(),
    });

    // Update sidebar when active file changes
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        const view = this.getView();
        if (view) view.showSimilarToActive();
      }),
    );

    // Auto-index on file changes
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (this.settings.autoIndex && file instanceof TFile && file.extension === "md") {
          this.queueReindex(file.path);
        }
      }),
    );
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (this.settings.autoIndex && file instanceof TFile && file.extension === "md") {
          this.queueReindex(file.path);
        }
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (file instanceof TFile && file.extension === "md") {
          if (this.index?.notes[oldPath]) {
            delete this.index.notes[oldPath];
          }
          if (this.settings.autoIndex) {
            this.queueReindex(file.path);
          }
        }
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile && file.extension === "md") {
          if (this.index?.notes[file.path]) {
            delete this.index.notes[file.path];
            this.saveIndex();
          }
        }
      }),
    );
  }

  async onunload(): Promise<void> {}

  getIndexPath(): string {
    if (this.settings.indexPath) {
      return this.settings.indexPath;
    }
    return `${this.manifest.dir}/${EMBEDDINGS_FILE}`;
  }

  async loadIndex(): Promise<void> {
    try {
      const path = this.getIndexPath();
      const adapter = this.app.vault.adapter;
      if (await adapter.exists(path)) {
        const raw = await adapter.read(path);
        this.index = JSON.parse(raw) as EmbeddingsIndex;
        console.log(
          `Vector Search: loaded ${Object.keys(this.index.notes).length} note embeddings`,
        );
      } else {
        console.log("Vector Search: no embeddings.json found");
        this.index = {
          model: this.settings.model,
          dimension: 384,
          indexed_at: new Date().toISOString(),
          notes: {},
        };
      }
    } catch (e) {
      console.error("Vector Search: failed to load index", e);
    }
  }

  async saveIndex(): Promise<void> {
    if (!this.index) return;
    try {
      const path = this.getIndexPath();
      this.index.indexed_at = new Date().toISOString();
      await this.app.vault.adapter.write(path, JSON.stringify(this.index));
    } catch (e) {
      console.error("Vector Search: failed to save index", e);
    }
  }

  private isExcluded(path: string): boolean {
    const excluded = this.settings.excludeFolders
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const folder of excluded) {
      if (path.startsWith(folder + "/") || path === folder) return true;
    }
    return false;
  }

  private queueReindex(path: string): void {
    if (this.isExcluded(path)) return;
    this.pendingFiles.add(path);
    this.flushPending();
  }

  private async reindexPending(): Promise<void> {
    if (this.pendingFiles.size === 0) return;
    const paths = [...this.pendingFiles];
    this.pendingFiles.clear();

    if (!this.index) {
      this.index = {
        model: this.settings.model,
        dimension: 384,
        indexed_at: new Date().toISOString(),
        notes: {},
      };
    }

    let count = 0;
    for (const path of paths) {
      try {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) continue;
        const content = await this.app.vault.cachedRead(file);
        const stripped = this.stripFrontmatter(content);
        if (stripped.length < 20) continue;

        const truncated = stripped.slice(0, this.settings.truncationLength);
        const vec = await embedQuery(truncated, this.settings.model);
        const title = this.extractTitle(stripped, file.basename);
        const mtime = Math.floor(file.stat.mtime / 1000);
        this.index.notes[path] = { v: vec, title, mtime };
        count++;
      } catch (e) {
        console.error(`Vector Search: failed to embed ${path}`, e);
      }
    }

    if (count > 0) {
      await this.saveIndex();
      console.log(`Vector Search: re-embedded ${count} note(s)`);
      const view = this.getView();
      if (view) view.showSimilarToActive();
    }
  }

  private async reindexAll(): Promise<void> {
    const files = this.app.vault.getMarkdownFiles();
    for (const file of files) {
      if (!this.isExcluded(file.path)) {
        this.pendingFiles.add(file.path);
      }
    }
    await this.reindexPending();
  }

  private stripFrontmatter(content: string): string {
    if (!content.startsWith("---")) return content;
    const end = content.indexOf("---", 3);
    if (end === -1) return content;
    return content.slice(end + 3).trim();
  }

  private extractTitle(content: string, fallback: string): string {
    const match = content.match(/^#\s+(.+)$/m);
    if (match) return match[1].trim();
    return fallback.replace(/-/g, " ");
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
  }

  async saveSettings(): Promise<void> {
    await this.saveData(this.settings);
    resetEmbedder();
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
