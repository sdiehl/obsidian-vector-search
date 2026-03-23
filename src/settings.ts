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
  indexMode: "on-save" | "interval" | "manual" | "readonly";
  autoIndexInterval: number;
  includeFrontmatter: boolean;
  titleWeight: number;
  includePath: boolean;
  minContentLength: number;
  lowercase: boolean;
  stripUrls: boolean;
  stripMarkdown: boolean;
  stripPatterns: string;
  includeGlobs: string;
}

export const DEFAULT_SETTINGS: VectorSearchSettings = {
  model: "Xenova/all-MiniLM-L6-v2",
  maxResults: 20,
  minScore: 0.1,
  indexPath: "",
  excludeFolders: "daily, scratch, templates",
  truncationLength: 2000,
  showScores: true,
  indexMode: "on-save",
  autoIndexInterval: 60,
  includeFrontmatter: true,
  titleWeight: 1,
  includePath: false,
  minContentLength: 20,
  lowercase: false,
  stripUrls: false,
  stripMarkdown: false,
  stripPatterns: "",
  includeGlobs: "",
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

    const readonly = this.plugin.settings.indexMode === "readonly";

    containerEl.createEl("h2", { text: "Vector Search Settings" });

    // -- Index management --
    const indexInfo = this.plugin.index
      ? `${Object.keys(this.plugin.index.notes).length} notes indexed`
      : "No index";

    const indexSetting = new Setting(containerEl)
      .setName("Index")
      .setDesc(indexInfo);

    const progressEl = containerEl.createDiv({ cls: "vector-search-progress" });

    if (!readonly) {
      indexSetting
        .addButton((btn) => {
          btn.setButtonText("Rebuild").onClick(async () => {
            btn.setDisabled(true);
            btn.setButtonText("Indexing...");
            const start = Date.now();
            this.plugin.onIndexProgress = (done, total) => {
              progressEl.textContent = `Embedding ${done} / ${total} notes...`;
              indexSetting.setDesc(`${done}/${total}`);
            };
            await this.plugin.rebuildIndex();
            this.plugin.onIndexProgress = null;
            const elapsed = ((Date.now() - start) / 1000).toFixed(1);
            const notes = Object.keys(this.plugin.index?.notes || {}).length;
            progressEl.textContent = `Done: ${notes} notes indexed in ${elapsed}s`;
            btn.setDisabled(false);
            btn.setButtonText("Rebuild");
          });
        })
        .addButton((btn) => {
          btn.setButtonText("Clear").setWarning().onClick(async () => {
            await this.plugin.clearIndex();
            this.display();
          });
        });
    }

    new Setting(containerEl)
      .setName("Indexing mode")
      .setDesc(
        "On save: re-embeds when you navigate away from a modified note. Interval: periodic full re-index. Manual: rebuild button only. Read-only: iPad mode, search only.",
      )
      .addDropdown((drop) => {
        drop.addOption("on-save", "On save");
        drop.addOption("interval", "On interval (periodic)");
        drop.addOption("manual", "Manual only");
        drop.addOption("readonly", "Read-only (iPad mode)");
        drop.setValue(this.plugin.settings.indexMode);
        drop.onChange(async (value: string) => {
          this.plugin.settings.indexMode = value as VectorSearchSettings["indexMode"];
          await this.plugin.saveSettings();
          this.plugin.setupIndexing();
          this.display();
        });
      });

    if (!readonly) {
      new Setting(containerEl)
        .setName("Index interval (seconds)")
        .setDesc(
          "On-change: debounce delay before re-embedding. Interval: how often to re-index all notes.",
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
    }

    // -- Display --
    containerEl.createEl("h3", { text: "Display" });

    new Setting(containerEl)
      .setName("Embedding model")
      .setDesc(
        "Model for ad-hoc search queries. Changing this requires a rebuild.",
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
      .setDesc("Maximum number of similar notes to show.")
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
      .setDesc("Hide results below this threshold (0.0 to 1.0).")
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

    // -- Indexing settings (hidden in readonly) --
    if (!readonly) {
      containerEl.createEl("h3", { text: "Content Processing" });

      new Setting(containerEl)
        .setName("Include frontmatter tags")
        .setDesc(
          "Embed YAML tags alongside content. Improves topic matching.",
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
          "Prepend the note title N times. Titles carry strong semantic signal. 0 to disable.",
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
          "Prepend file path (e.g. 'formal-methods/cedar') for folder-based topic signal.",
        )
        .addToggle((toggle) => {
          toggle.setValue(this.plugin.settings.includePath);
          toggle.onChange(async (value) => {
            this.plugin.settings.includePath = value;
            await this.plugin.saveSettings();
          });
        });

      containerEl.createEl("h3", { text: "Normalization" });

      new Setting(containerEl)
        .setName("Lowercase")
        .setDesc("Convert text to lowercase before embedding.")
        .addToggle((toggle) => {
          toggle.setValue(this.plugin.settings.lowercase);
          toggle.onChange(async (value) => {
            this.plugin.settings.lowercase = value;
            await this.plugin.saveSettings();
          });
        });

      new Setting(containerEl)
        .setName("Strip URLs")
        .setDesc("Remove URLs from content before embedding.")
        .addToggle((toggle) => {
          toggle.setValue(this.plugin.settings.stripUrls);
          toggle.onChange(async (value) => {
            this.plugin.settings.stripUrls = value;
            await this.plugin.saveSettings();
          });
        });

      new Setting(containerEl)
        .setName("Strip markdown syntax")
        .setDesc(
          "Remove markdown formatting (headings markers, bold, italic, links, code fences) before embedding.",
        )
        .addToggle((toggle) => {
          toggle.setValue(this.plugin.settings.stripMarkdown);
          toggle.onChange(async (value) => {
            this.plugin.settings.stripMarkdown = value;
            await this.plugin.saveSettings();
          });
        });

      new Setting(containerEl)
        .setName("Strip patterns (regex)")
        .setDesc(
          "Custom regex patterns to strip from content, one per line. Applied before embedding.",
        )
        .addTextArea((text) => {
          text.setPlaceholder("e.g.\n\\[\\[.*?\\]\\]\n<!--.*?-->");
          text.setValue(this.plugin.settings.stripPatterns);
          text.onChange(async (value) => {
            this.plugin.settings.stripPatterns = value;
            await this.plugin.saveSettings();
          });
        });

      containerEl.createEl("h3", { text: "File Selection" });

      new Setting(containerEl)
        .setName("Exclude folders")
        .setDesc("Comma-separated folder names to skip when indexing.")
        .addText((text) => {
          text.setValue(this.plugin.settings.excludeFolders);
          text.onChange(async (value) => {
            this.plugin.settings.excludeFolders = value;
            await this.plugin.saveSettings();
          });
        });

      new Setting(containerEl)
        .setName("Include only (glob patterns)")
        .setDesc(
          "If set, only index files matching these patterns. Comma-separated. e.g. 'projects/*, onechronos/*'. Empty means all files.",
        )
        .addText((text) => {
          text.setPlaceholder("e.g. projects/*, formal-methods/*");
          text.setValue(this.plugin.settings.includeGlobs);
          text.onChange(async (value) => {
            this.plugin.settings.includeGlobs = value;
            await this.plugin.saveSettings();
          });
        });

      new Setting(containerEl)
        .setName("Minimum content length")
        .setDesc("Skip notes shorter than this many characters.")
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

      new Setting(containerEl)
        .setName("Truncation length")
        .setDesc("Max characters per note to embed. Longer notes are truncated.")
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

      new Setting(containerEl)
        .setName("Index file path")
        .setDesc(
          "Custom path for embeddings.json (relative to vault root). Leave empty for default.",
        )
        .addText((text) => {
          text.setPlaceholder("e.g. .obsidian/vector-index.json");
          text.setValue(this.plugin.settings.indexPath);
          text.onChange(async (value) => {
            this.plugin.settings.indexPath = value.trim();
            await this.plugin.saveSettings();
          });
        });
    }
  }
}
