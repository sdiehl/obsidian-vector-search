import { App, PluginSettingTab, Setting } from "obsidian";
import type VectorSearchPlugin from "./main";

export const MODELS: Record<string, { name: string; dim: number; size: string }> = {
  "Xenova/all-MiniLM-L6-v2": {
    name: "MiniLM-L6 (default, fast, 23MB)",
    dim: 384,
    size: "23MB",
  },
  "Xenova/all-MiniLM-L12-v2": {
    name: "MiniLM-L12 (more accurate, 33MB)",
    dim: 384,
    size: "33MB",
  },
  "Xenova/bge-small-en-v1.5": {
    name: "BGE Small (BAAI, 33MB)",
    dim: 384,
    size: "33MB",
  },
};

export interface VectorSearchSettings {
  model: string;
  maxResults: number;
  minScore: number;
  indexPath: string;
  excludeFolders: string;
  truncationLength: number;
  showScores: boolean;
  indexMode: "on-change" | "interval" | "manual" | "readonly";
  autoIndexInterval: number;
  includeFrontmatter: boolean;
  titleWeight: number;
  includePath: boolean;
  minContentLength: number;
}

export const DEFAULT_SETTINGS: VectorSearchSettings = {
  model: "Xenova/all-MiniLM-L6-v2",
  maxResults: 20,
  minScore: 0.1,
  indexPath: "",
  excludeFolders: "daily, scratch, templates",
  truncationLength: 2000,
  showScores: true,
  indexMode: "on-change",
  autoIndexInterval: 60,
  includeFrontmatter: true,
  titleWeight: 1,
  includePath: false,
  minContentLength: 20,
};

export class VectorSearchSettingTab extends PluginSettingTab {
  plugin: VectorSearchPlugin;

  constructor(app: App, plugin: VectorSearchPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();

    containerEl.createEl("h2", { text: "Vector Search Settings" });

    // Index management buttons
    const indexInfo = this.plugin.index
      ? `${Object.keys(this.plugin.index.notes).length} notes indexed`
      : "No index";

    new Setting(containerEl)
      .setName("Index")
      .setDesc(indexInfo)
      .addButton((btn) => {
        btn.setButtonText("Rebuild").onClick(async () => {
          btn.setDisabled(true);
          btn.setButtonText("Indexing...");
          await this.plugin.rebuildIndex();
          btn.setDisabled(false);
          btn.setButtonText("Rebuild");
          this.display();
        });
      })
      .addButton((btn) => {
        btn.setButtonText("Clear").setWarning().onClick(async () => {
          await this.plugin.clearIndex();
          this.display();
        });
      });

    new Setting(containerEl)
      .setName("Embedding model")
      .setDesc(
        "Model used for ad-hoc search queries. Changing this requires re-indexing with the same model.",
      )
      .addDropdown((drop) => {
        for (const [id, info] of Object.entries(MODELS)) {
          drop.addOption(id, info.name);
        }
        drop.setValue(this.plugin.settings.model);
        drop.onChange(async (value) => {
          this.plugin.settings.model = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Max results")
      .setDesc("Maximum number of similar notes to show in the sidebar.")
      .addText((text) => {
        text.setValue(String(this.plugin.settings.maxResults));
        text.onChange(async (value) => {
          const n = parseInt(value, 10);
          if (!isNaN(n) && n > 0) {
            this.plugin.settings.maxResults = n;
            await this.plugin.saveSettings();
          }
        });
      });

    new Setting(containerEl)
      .setName("Minimum similarity score")
      .setDesc(
        "Hide results below this cosine similarity threshold (0.0 to 1.0).",
      )
      .addText((text) => {
        text.setValue(String(this.plugin.settings.minScore));
        text.onChange(async (value) => {
          const n = parseFloat(value);
          if (!isNaN(n) && n >= 0 && n <= 1) {
            this.plugin.settings.minScore = n;
            await this.plugin.saveSettings();
          }
        });
      });

    new Setting(containerEl)
      .setName("Show similarity scores")
      .setDesc("Display percentage scores next to each result.")
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.showScores);
        toggle.onChange(async (value) => {
          this.plugin.settings.showScores = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Indexing mode")
      .setDesc(
        "How to keep embeddings up to date. 'On change' re-embeds after edits. 'Interval' re-indexes all notes periodically. 'Manual' only indexes via the Rebuild button.",
      )
      .addDropdown((drop) => {
        drop.addOption("on-change", "On change (debounced)");
        drop.addOption("interval", "On interval (periodic)");
        drop.addOption("manual", "Manual only");
        drop.addOption("readonly", "Read-only (iPad mode)");
        drop.setValue(this.plugin.settings.indexMode);
        drop.onChange(async (value: string) => {
          this.plugin.settings.indexMode = value as "on-change" | "interval" | "manual" | "readonly";
          await this.plugin.saveSettings();
          this.plugin.setupIndexing();
        });
      });

    new Setting(containerEl)
      .setName("Index interval (seconds)")
      .setDesc(
        "For 'on change' mode: debounce delay. For 'interval' mode: how often to re-index all notes.",
      )
      .addText((text) => {
        text.setValue(String(this.plugin.settings.autoIndexInterval));
        text.onChange(async (value) => {
          const n = parseInt(value, 10);
          if (!isNaN(n) && n >= 1) {
            this.plugin.settings.autoIndexInterval = n;
            await this.plugin.saveSettings();
            this.plugin.setupIndexing();
          }
        });
      });

    new Setting(containerEl)
      .setName("Index file path")
      .setDesc(
        "Custom path for embeddings.json (relative to vault root). Leave empty for default (plugin directory).",
      )
      .addText((text) => {
        text.setPlaceholder("e.g. .obsidian/vector-index.json");
        text.setValue(this.plugin.settings.indexPath);
        text.onChange(async (value) => {
          this.plugin.settings.indexPath = value.trim();
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Exclude folders (indexer)")
      .setDesc(
        "Comma-separated folder names to exclude when indexing. Used by the CLI indexer.",
      )
      .addText((text) => {
        text.setValue(this.plugin.settings.excludeFolders);
        text.onChange(async (value) => {
          this.plugin.settings.excludeFolders = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Truncation length")
      .setDesc(
        "Max characters of note content to embed. Longer notes are truncated.",
      )
      .addText((text) => {
        text.setValue(String(this.plugin.settings.truncationLength));
        text.onChange(async (value) => {
          const n = parseInt(value, 10);
          if (!isNaN(n) && n > 0) {
            this.plugin.settings.truncationLength = n;
            await this.plugin.saveSettings();
          }
        });
      });

    containerEl.createEl("h3", { text: "Search Quality" });

    new Setting(containerEl)
      .setName("Include frontmatter tags")
      .setDesc(
        "Embed YAML frontmatter tags alongside note content. Tags like 'lean4, onechronos' improve topic matching.",
      )
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.includeFrontmatter);
        toggle.onChange(async (value) => {
          this.plugin.settings.includeFrontmatter = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Title weight")
      .setDesc(
        "Prepend the note title N times before content. Titles carry strong semantic signal. 0 to disable.",
      )
      .addText((text) => {
        text.setValue(String(this.plugin.settings.titleWeight));
        text.onChange(async (value) => {
          const n = parseInt(value, 10);
          if (!isNaN(n) && n >= 0) {
            this.plugin.settings.titleWeight = n;
            await this.plugin.saveSettings();
          }
        });
      });

    new Setting(containerEl)
      .setName("Include file path")
      .setDesc(
        "Prepend the file path (e.g. 'formal-methods/cedar') to content. Folder names carry topic signal.",
      )
      .addToggle((toggle) => {
        toggle.setValue(this.plugin.settings.includePath);
        toggle.onChange(async (value) => {
          this.plugin.settings.includePath = value;
          await this.plugin.saveSettings();
        });
      });

    new Setting(containerEl)
      .setName("Minimum content length")
      .setDesc("Skip notes shorter than this many characters after processing.")
      .addText((text) => {
        text.setValue(String(this.plugin.settings.minContentLength));
        text.onChange(async (value) => {
          const n = parseInt(value, 10);
          if (!isNaN(n) && n >= 0) {
            this.plugin.settings.minContentLength = n;
            await this.plugin.saveSettings();
          }
        });
      });
  }
}
