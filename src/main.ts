import { Notice, Plugin, TFile, WorkspaceLeaf, debounce } from "obsidian";
import { VectorSearchView, VIEW_TYPE } from "./view";
import {
  createDb,
  loadDb,
  saveDb,
  clearDb,
  noteCount,
  upsertNote,
  removeNote,
  getNoteMtime,
  getNoteVec,
  findSimilar,
  getAllPaths,
} from "./vectors";
import { resetEmbedder, embedQuery } from "./embedder";
import {
  VectorSearchSettingTab,
  DEFAULT_SETTINGS,
  type VectorSearchSettings,
} from "./settings";

const INDEX_FILE = "orama-index.json";

export default class VectorSearchPlugin extends Plugin {
  settings: VectorSearchSettings = DEFAULT_SETTINGS;
  indexing = false;
  onIndexProgress: ((done: number, total: number) => void) | null = null;
  private pendingFiles: Set<string> = new Set();
  private flushPending: () => void;
  private intervalTimer: ReturnType<typeof setInterval> | null = null;

  constructor(app: any, manifest: any) {
    super(app, manifest);
    this.flushPending = debounce(() => this.reindexPending(), 5_000, true);
  }

  async onload(): Promise<void> {
    try {
      await this.loadSettings();
    } catch (e) {
      console.error("Vector Search: failed to load settings", e);
    }
    try {
      await this.loadIndex();
    } catch (e) {
      console.error("Vector Search: failed to load index", e);
    }
    try {
      await this.ensureGitignore();
    } catch {
      // non-critical
    }

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

    // Update sidebar and re-index previous file on leaf change.
    // When you navigate away from a note, we check if it changed
    // since we last indexed it and re-embed if so.
    let previousFile: TFile | null = null;
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", () => {
        if (previousFile && this.settings.indexMode === "on-save") {
          // Re-read the TFile to get fresh mtime (the cached reference may be stale)
          const freshFile = this.app.vault.getAbstractFileByPath(previousFile.path);
          if (freshFile instanceof TFile) {
            this.reindexIfStale(freshFile);
          }
        }
        previousFile = this.app.workspace.getActiveFile();
        const view = this.getView();
        if (view) view.showSimilarToActive();
      }),
    );

    // Re-index on file save (modify fires when Obsidian writes to disk)
    this.registerEvent(
      this.app.vault.on("modify", (file) => {
        if (file instanceof TFile && file.extension === "md" && this.settings.indexMode === "on-save") {
          this.queueReindex(file.path);
        }
      }),
    );
    this.registerEvent(
      this.app.vault.on("create", (file) => {
        if (file instanceof TFile && file.extension === "md" && this.settings.indexMode !== "readonly") {
          this.queueReindex(file.path);
        }
      }),
    );
    this.registerEvent(
      this.app.vault.on("rename", (file, oldPath) => {
        if (file instanceof TFile && file.extension === "md" && this.settings.indexMode !== "readonly") {
          removeNote(oldPath);
          // Always reindex on rename (path changed, title may have changed)
          this.queueReindex(file.path);
        }
      }),
    );
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (file instanceof TFile && file.extension === "md" && this.settings.indexMode !== "readonly") {
          removeNote(file.path);
          this.saveIndex();
        }
      }),
    );

    this.app.workspace.onLayoutReady(() => {
      this.setupIndexing();
      const view = this.getView();
      if (view) view.showSimilarToActive();

      noteCount().then((n) => {
        if (n === 0 && this.settings.indexMode !== "readonly") {
          setTimeout(() => this.rebuildIndex(), 5000);
        }
      });
    });
  }

  async onunload(): Promise<void> {
    this.clearInterval();
  }

  setupIndexing(): void {
    this.clearInterval();
    const ms = this.settings.autoIndexInterval * 1000;
    this.flushPending = debounce(() => this.reindexPending(), ms, true);

    if (this.settings.indexMode === "interval") {
      this.intervalTimer = setInterval(() => {
        this.rebuildIndex().catch((e) =>
          console.error("Vector Search: interval rebuild failed", e),
        );
      }, ms);
    }
  }

  private clearInterval(): void {
    if (this.intervalTimer !== null) {
      clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
  }

  private reindexIfStale(file: TFile): void {
    if (this.isExcluded(file.path)) return;
    const mtime = Math.floor(file.stat.mtime / 1000);
    const existing = getNoteMtime(file.path);
    if (existing !== null && existing === mtime) return;
    this.queueReindex(file.path);
  }

  private queueReindex(path: string): void {
    if (this.isExcluded(path)) return;
    this.pendingFiles.add(path);
    this.flushPending();
  }

  getIndexPath(): string {
    if (this.settings.indexPath) {
      return this.settings.indexPath;
    }
    return `${this.manifest.dir}/${INDEX_FILE}`;
  }

  async loadIndex(): Promise<void> {
    try {
      const path = this.getIndexPath();
      const adapter = this.app.vault.adapter;
      if (await adapter.exists(path)) {
        const raw = await adapter.read(path);
        const data = JSON.parse(raw);
        await loadDb(data);
        const n = await noteCount();
        console.log(`Vector Search: loaded ${n} note embeddings`);
      } else {
        await createDb();
      }
    } catch (e) {
      console.error("Vector Search: failed to load index", e);
      await createDb();
    }
  }

  async saveIndex(): Promise<void> {
    if (this.settings.indexMode === "readonly") return;
    try {
      const path = this.getIndexPath();
      const data = await saveDb();
      if (data) {
        await this.app.vault.adapter.write(path, JSON.stringify(data));
      }
    } catch (e) {
      console.error("Vector Search: failed to save index", e);
    }
  }

  async getNoteCount(): Promise<number> {
    return noteCount();
  }

  getNoteVector(path: string): number[] | null {
    return getNoteVec(path);
  }

  async findSimilarNotes(
    vec: number[],
    excludePath?: string,
  ): Promise<{ path: string; title: string; score: number }[]> {
    return findSimilar(
      vec,
      excludePath,
      this.settings.maxResults,
      this.settings.minScore,
    );
  }

  isFileExcluded(path: string): string | null {
    const excluded = this.settings.excludeFolders
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    for (const folder of excluded) {
      if (path.startsWith(folder + "/") || path === folder) return folder;
    }
    return null;
  }

  private isExcluded(path: string): boolean {
    if (this.isFileExcluded(path)) return true;
    const includeGlobs = this.settings.includeGlobs
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
    if (includeGlobs.length > 0) {
      const matches = includeGlobs.some((pattern) => {
        const regex = pattern
          .replace(/\./g, "\\.")
          .replace(/\*\*/g, "__.GLOBSTAR__")
          .replace(/\*/g, "[^/]*")
          .replace(/__\.GLOBSTAR__/g, ".*");
        return new RegExp("^" + regex).test(path);
      });
      if (!matches) return true;
    }
    return false;
  }

  private async reindexPending(): Promise<void> {
    if (this.pendingFiles.size === 0 || this.indexing) return;
    if (this.settings.indexMode === "readonly") return;
    const paths = [...this.pendingFiles];
    this.pendingFiles.clear();

    let count = 0;
    for (const path of paths) {
      try {
        const file = this.app.vault.getAbstractFileByPath(path);
        if (!(file instanceof TFile)) continue;
        const mtime = Math.floor(file.stat.mtime / 1000);
        const existing = getNoteMtime(path);
        if (existing !== null && existing === mtime) continue;

        const raw = await this.app.vault.cachedRead(file);
        const prepared = this.prepareContent(raw, path, file.basename);
        if (prepared.text.length < this.settings.minContentLength) continue;

        const truncated = prepared.text.slice(0, this.settings.truncationLength);
        const vec = await embedQuery(truncated, this.settings.model);
        await upsertNote(path, prepared.title, truncated, mtime, vec);
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
      }
      return;
    }
    this.indexing = true;
    const view = this.getView();

    const files = this.app.vault.getMarkdownFiles().filter(
      (f) => !this.isExcluded(f.path),
    );
    const total = files.length;

    const updateStatus = (msg: string) => {
      if (view) view.setIndexingStatus(msg);
    };

    // Remove notes that no longer exist
    const validPaths = new Set(files.map((f) => f.path));
    const indexedPaths = await getAllPaths();
    for (const p of indexedPaths) {
      if (!validPaths.has(p)) {
        await removeNote(p);
      }
    }

    let embedded = 0;
    let skipped = 0;
    let errors = 0;
    for (const file of files) {
      try {
        const mtime = Math.floor(file.stat.mtime / 1000);
        const existingMtime = getNoteMtime(file.path);

        if (existingMtime !== null && existingMtime === mtime) {
          skipped++;
          continue;
        }

        const raw = await this.app.vault.cachedRead(file);
        const prepared = this.prepareContent(raw, file.path, file.basename);
        if (prepared.text.length < this.settings.minContentLength) continue;

        const truncated = prepared.text.slice(0, this.settings.truncationLength);
        const vec = await embedQuery(truncated, this.settings.model);
        await upsertNote(file.path, prepared.title, truncated, mtime, vec);
        embedded++;
        updateStatus(`Indexing ${embedded + skipped}/${total} (${skipped} cached)...`);
        if (this.onIndexProgress) this.onIndexProgress(embedded + skipped, total);
      } catch (e) {
        errors++;
        console.error(`Vector Search: failed to embed ${file.path}`, e);
      }
    }

    await this.saveIndex();
    this.indexing = false;
    console.log(`Vector Search: ${embedded} embedded, ${skipped} cached, ${errors} errors`);
    updateStatus("");
    if (view) {
      view.forceShowSimilar();
    }
  }

  async clearIndex(): Promise<void> {
    if (this.settings.indexMode === "readonly") {
      new Notice("Vector Search: read-only mode, cannot clear index");
      return;
    }
    await clearDb();
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

    let text = prefix + body;

    if (this.settings.stripUrls) {
      text = text.replace(/https?:\/\/[^\s)>\]]+/g, "");
    }
    if (this.settings.stripMarkdown) {
      text = text
        .replace(/^#{1,6}\s+/gm, "")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .replace(/\*([^*]+)\*/g, "$1")
        .replace(/__([^_]+)__/g, "$1")
        .replace(/_([^_]+)_/g, "$1")
        .replace(/`{3}[\s\S]*?`{3}/g, "")
        .replace(/`([^`]+)`/g, "$1")
        .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
    }
    if (this.settings.stripPatterns) {
      for (const line of this.settings.stripPatterns.split("\n")) {
        const pat = line.trim();
        if (pat.length === 0) continue;
        try {
          text = text.replace(new RegExp(pat, "g"), "");
        } catch {
          // invalid regex
        }
      }
    }
    if (this.settings.lowercase) {
      text = text.toLowerCase();
    }

    return { text, title };
  }

  private async ensureGitignore(): Promise<void> {
    try {
      const path = `${this.manifest.dir}/.gitignore`;
      const adapter = this.app.vault.adapter;
      if (!(await adapter.exists(path))) {
        await adapter.write(path, "embeddings.json\norama-index.json\ndata.json\ndebug.log\n");
      }
    } catch {
      // Non-critical
    }
  }

  async loadSettings(): Promise<void> {
    this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
    if ((this.settings.indexMode as string) === "on-change") {
      this.settings.indexMode = "on-save";
    }
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
