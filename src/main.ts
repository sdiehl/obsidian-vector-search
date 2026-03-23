import { Notice, Plugin, TFile, WorkspaceLeaf, debounce } from "obsidian";
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
  indexing = false;
  private pendingFiles: Set<string> = new Set();
  private flushPending: () => void;
  private intervalTimer: ReturnType<typeof setInterval> | null = null;

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
      id: "rebuild-index",
      name: "Rebuild entire index",
      callback: () => this.rebuildIndex(),
    });

    // Update sidebar when active file changes
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        const view = this.getView();
        if (view) view.showSimilarToActive();
      }),
    );

    // File change listeners (gated by indexMode in the handler)
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile && file.extension === "md") {
          this.onFileChanged(file.path);
        }
      }),
    );
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (file instanceof TFile && file.extension === "md") {
          this.onFileChanged(file.path);
        }
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (file instanceof TFile && file.extension === "md") {
          if (this.index?.notes[oldPath]) {
            delete this.index.notes[oldPath];
          }
          this.onFileChanged(file.path);
        }
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile && file.extension === "md" && this.settings.indexMode !== "readonly") {
          if (this.index?.notes[file.path]) {
            delete this.index.notes[file.path];
            this.saveIndex();
          }
        }
      }),
    );

    this.setupIndexing();

    // Auto-build on first load if empty and not readonly
    if (
      this.index &&
      Object.keys(this.index.notes).length === 0 &&
      this.settings.indexMode !== "readonly"
    ) {
      setTimeout(() => this.rebuildIndex(), 3000);
    }
  }

  async onunload(): Promise<void> {
    this.clearInterval();
  }

  setupIndexing(): void {
    this.clearInterval();
    const ms = this.settings.autoIndexInterval * 1000;
    this.flushPending = debounce(() => this.reindexPending(), ms, true);

    if (this.settings.indexMode === "interval") {
      this.intervalTimer = setInterval(() => this.rebuildIndex(), ms);
    }
  }

  private clearInterval(): void {
    if (this.intervalTimer !== null) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
  }

  private onFileChanged(path: string): void {
    if (this.settings.indexMode !== "on-change") return;
    if (this.isExcluded(path)) return;
    this.pendingFiles.add(path);
    this.flushPending();
  }

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
    if (!this.index || this.settings.indexMode === "readonly") return;
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

  private async reindexPending(): Promise<void> {
    if (this.pendingFiles.size === 0 || this.indexing) return;
    if (this.settings.indexMode === "readonly") return;
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
        const raw = await this.app.vault.cachedRead(file);
        const prepared = this.prepareContent(raw, path, file.basename);
        if (prepared.text.length < this.settings.minContentLength) continue;

        const truncated = prepared.text.slice(0, this.settings.truncationLength);
        const vec = await embedQuery(truncated, this.settings.model);
        const mtime = Math.floor(file.stat.mtime / 1000);
        this.index.notes[path] = { v: vec, title: prepared.title, mtime };
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

  async rebuildIndex(): Promise<void> {
    if (this.indexing || this.settings.indexMode === "readonly") {
      if (this.settings.indexMode === "readonly") {
        new Notice("Vector Search: read-only mode, indexing disabled");
      } else {
        new Notice("Vector Search: indexing already in progress");
      }
      return;
    }
    this.indexing = true;

    const files = this.app.vault.getMarkdownFiles().filter(
      (f) => !this.isExcluded(f.path),
    );
    const total = files.length;
    new Notice(`Vector Search: indexing ${total} notes...`);

    this.index = {
      model: this.settings.model,
      dimension: 384,
      indexed_at: new Date().toISOString(),
      notes: {},
    };

    let count = 0;
    let errors = 0;
    for (const file of files) {
      try {
        const raw = await this.app.vault.cachedRead(file);
        const prepared = this.prepareContent(raw, file.path, file.basename);
        if (prepared.text.length < this.settings.minContentLength) continue;

        const truncated = prepared.text.slice(0, this.settings.truncationLength);
        const vec = await embedQuery(truncated, this.settings.model);
        const mtime = Math.floor(file.stat.mtime / 1000);
        this.index.notes[file.path] = { v: vec, title: prepared.title, mtime };
        count++;

        if (count % 10 === 0) {
          new Notice(`Vector Search: ${count}/${total} notes embedded...`, 2000);
        }
      } catch (e) {
        errors++;
        console.error(`Vector Search: failed to embed ${file.path}`, e);
      }
    }

    await this.saveIndex();
    this.indexing = false;
    new Notice(
      `Vector Search: indexed ${count} notes` +
        (errors > 0 ? ` (${errors} errors)` : ""),
    );

    const view = this.getView();
    if (view) view.showSimilarToActive();
  }

  async clearIndex(): Promise<void> {
    if (this.settings.indexMode === "readonly") {
      new Notice("Vector Search: read-only mode, cannot clear index");
      return;
    }
    this.index = {
      model: this.settings.model,
      dimension: 384,
      indexed_at: new Date().toISOString(),
      notes: {},
    };
    await this.saveIndex();
    new Notice("Vector Search: index cleared");
    const view = this.getView();
    if (view) view.showSimilarToActive();
  }

  prepareContent(
    raw: string,
    filePath: string,
    fallbackTitle: string,
  ): { text: string; title: string } {
    let body = raw;
    let tags: string[] = [];

    if (raw.startsWith("---")) {
      const end = raw.indexOf("---", 3);
      if (end !== -1) {
        const fm = raw.slice(3, end);
        body = raw.slice(end + 3).trim();
        const tagMatch = fm.match(/^tags:\s*\[([^\]]*)\]/m);
        if (tagMatch) {
          tags = tagMatch[1].split(",").map((t) => t.trim()).filter(Boolean);
        } else {
          const lines = fm.split("\n");
          let inTags = false;
          for (const line of lines) {
            if (/^tags:\s*$/.test(line)) {
              inTags = true;
            } else if (inTags && /^\s+-\s+(.+)/.test(line)) {
              const m = line.match(/^\s+-\s+(.+)/);
              if (m) tags.push(m[1].trim());
            } else if (inTags && !/^\s*$/.test(line)) {
              inTags = false;
            }
          }
        }
      }
    }

    const titleMatch = body.match(/^#\s+(.+)$/m);
    const title = titleMatch ? titleMatch[1].trim() : fallbackTitle.replace(/-/g, " ");

    let prefix = "";
    if (this.settings.includePath) {
      const pathWithoutExt = filePath.replace(/\.md$/, "");
      prefix += `path: ${pathWithoutExt}\n`;
    }
    for (let i = 0; i < this.settings.titleWeight; i++) {
      prefix += title + "\n";
    }
    if (this.settings.includeFrontmatter && tags.length > 0) {
      prefix += "tags: " + tags.join(", ") + "\n";
    }

    return { text: prefix + body, title };
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
