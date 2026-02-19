import {
	App,
	Plugin,
	PluginSettingTab,
	Setting,
	TFile,
	Notice,
	normalizePath,
} from "obsidian";

/* ------------------------------------------------------------------ */
/*  Settings                                                          */
/* ------------------------------------------------------------------ */

interface BasesPreviewSettings {
	previewLength: number;
	contentSource: "full-body" | "heading";
	headingName: string;
	showAddButton: boolean;
}

const DEFAULT_SETTINGS: BasesPreviewSettings = {
	previewLength: 200,
	contentSource: "full-body",
	headingName: "",
	showAddButton: true,
};

/* ------------------------------------------------------------------ */
/*  Plugin                                                            */
/* ------------------------------------------------------------------ */

export default class BasesPreviewPlugin extends Plugin {
	settings: BasesPreviewSettings = DEFAULT_SETTINGS;

	/** Active MutationObservers so we can disconnect on unload */
	private observers: MutationObserver[] = [];

	/** Debounce timer for observer callbacks */
	private debounceTimer: ReturnType<typeof setTimeout> | null = null;

	/* ---- lifecycle --------------------------------------------- */

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new BasesPreviewSettingTab(this.app, this));

		// We use a layout‑ready callback so the workspace DOM is available.
		this.app.workspace.onLayoutReady(() => {
			this.scanAndInject();
			this.installGlobalObserver();
		});
	}

	onunload() {
		this.disconnectObservers();
		this.removeInjected();
	}

	/* ---- settings ---------------------------------------------- */

	async loadSettings() {
		this.settings = Object.assign(
			{},
			DEFAULT_SETTINGS,
			await this.loadData()
		);
	}

	async saveSettings() {
		await this.saveData(this.settings);
		// Re‑inject with new settings
		this.removeInjected();
		this.scanAndInject();
	}

	/* ---- observer management ----------------------------------- */

	private installGlobalObserver() {
		const target = document.body;
		const observer = new MutationObserver(() => {
			// Debounce rapid DOM changes (Bases re‑renders a lot)
			if (this.debounceTimer) clearTimeout(this.debounceTimer);
			this.debounceTimer = setTimeout(() => this.scanAndInject(), 250);
		});
		observer.observe(target, { childList: true, subtree: true });
		this.observers.push(observer);
	}

	private disconnectObservers() {
		for (const o of this.observers) o.disconnect();
		this.observers = [];
		if (this.debounceTimer) {
			clearTimeout(this.debounceTimer);
			this.debounceTimer = null;
		}
	}

	/* ---- DOM scanning & injection ------------------------------ */

	/**
	 * Find every Bases table view in the DOM and inject previews +
	 * an optional "+" button.
	 *
	 * Bases renders inside `.workspace-leaf` containers.  Each Base
	 * table view uses a `<table>` element.  Rows that link to a note
	 * contain an internal‑link element whose `data‑href` / `href`
	 * attribute points at the file.
	 */
	private scanAndInject() {
		// Bases tables live inside elements with class "bases" or
		// inside any embedded block that contains a <table>.
		// We look for every table row that has a clickable note link.
		const tables = document.querySelectorAll<HTMLTableElement>(
			".bases-table table, table"
		);

		for (const table of Array.from(tables)) {
			// Only process tables that live inside a bases view
			if (!this.isBasesTable(table)) continue;

			this.injectPreviewsIntoTable(table);

			if (this.settings.showAddButton) {
				this.injectAddButton(table);
			}
		}
	}

	/**
	 * Heuristic: a table is a Bases table if it (or an ancestor)
	 * carries a class containing "bases" or if the closest
	 * `.workspace-leaf-content` has `[data-type="bases"]`.
	 */
	private isBasesTable(table: HTMLTableElement): boolean {
		// Check via data-type on the leaf
		const leaf = table.closest(".workspace-leaf-content");
		if (leaf && leaf.getAttribute("data-type") === "bases") return true;

		// Check via class heuristics – Bases adds various classes
		const parent = table.closest(
			'[class*="bases"], [class*="database"], [class*="base-view"]'
		);
		if (parent) return true;

		return false;
	}

	/**
	 * Walk each <tr> of the table body, find the note link,
	 * read the note, and append a preview <td> (or a sub‑row).
	 */
	private async injectPreviewsIntoTable(table: HTMLTableElement) {
		// Add preview column header if not already present
		const thead = table.querySelector("thead tr");
		if (thead && !thead.querySelector(".bases-preview-th")) {
			const th = document.createElement("th");
			th.className = "bases-preview-th";
			th.textContent = "Preview";
			thead.appendChild(th);
		}

		const rows = table.querySelectorAll<HTMLTableRowElement>("tbody tr");
		for (const row of Array.from(rows)) {
			if (row.querySelector(".bases-preview-cell")) continue; // already injected

			const link = row.querySelector<HTMLAnchorElement>(
				"a.internal-link, a[data-href]"
			);
			if (!link) continue;

			const href =
				link.getAttribute("data-href") || link.getAttribute("href");
			if (!href) continue;

			const file = this.app.metadataCache.getFirstLinkpathDest(
				href,
				""
			);
			if (!(file instanceof TFile)) continue;

			const preview = await this.getPreview(file);

			const td = document.createElement("td");
			td.className = "bases-preview-cell";
			td.textContent = preview;
			td.title = preview; // tooltip for overflow
			row.appendChild(td);
		}
	}

	/**
	 * Read a file and return the preview string.
	 */
	private async getPreview(file: TFile): Promise<string> {
		try {
			const content = await this.app.vault.cachedRead(file);
			const body = this.extractBody(content);
			const len = this.settings.previewLength;
			if (body.length <= len) return body;
			return body.slice(0, len) + "…";
		} catch {
			return "";
		}
	}

	/**
	 * Extract the relevant body text based on settings.
	 */
	private extractBody(raw: string): string {
		// Strip frontmatter
		let content = raw;
		if (content.startsWith("---")) {
			const end = content.indexOf("---", 3);
			if (end !== -1) {
				content = content.slice(end + 3).trim();
			}
		}

		if (this.settings.contentSource === "heading" && this.settings.headingName) {
			return this.extractHeadingSection(content, this.settings.headingName);
		}

		return content;
	}

	/**
	 * Pull out the text under a specific heading (any level).
	 */
	private extractHeadingSection(content: string, heading: string): string {
		const lines = content.split("\n");
		let capture = false;
		let captureLevel = 0;
		const result: string[] = [];

		for (const line of lines) {
			const match = line.match(/^(#{1,6})\s+(.*)/);
			if (match) {
				const level = match[1].length;
				const title = match[2].trim();

				if (capture) {
					// Stop when we hit same or higher-level heading
					if (level <= captureLevel) break;
				}

				if (title.toLowerCase() === heading.toLowerCase()) {
					capture = true;
					captureLevel = level;
					continue;
				}
			}

			if (capture) {
				result.push(line);
			}
		}

		return result.join("\n").trim();
	}

	/* ---- Add-note button --------------------------------------- */

	/**
	 * Inject a "+" button below the table to create a new note
	 * pre-populated with frontmatter matching the Base's filters.
	 */
	private injectAddButton(table: HTMLTableElement) {
		const wrapper = table.parentElement;
		if (!wrapper) return;
		if (wrapper.querySelector(".bases-preview-add-btn")) return; // already there

		const btn = document.createElement("button");
		btn.className = "bases-preview-add-btn";
		btn.textContent = "+ New note";
		btn.title = "Create a new note for this Base";
		btn.addEventListener("click", () => this.createNoteForBase(table));

		wrapper.appendChild(btn);
	}

	/**
	 * Gather the Base's current filters / column headers and produce
	 * matching YAML frontmatter in a new note.
	 */
	private async createNoteForBase(table: HTMLTableElement) {
		// Collect column names from <th> elements (skip our preview column)
		const headers: string[] = [];
		const thEls = table.querySelectorAll<HTMLTableCellElement>("thead th");
		for (const th of Array.from(thEls)) {
			if (th.classList.contains("bases-preview-th")) continue;
			const name = (th.textContent || "").trim();
			if (name) headers.push(name);
		}

		// Try to detect simple filter values from the first data row
		const filterValues: Record<string, string> = {};
		const firstRow = table.querySelector<HTMLTableRowElement>("tbody tr");
		if (firstRow) {
			const cells = firstRow.querySelectorAll<HTMLTableCellElement>("td");
			cells.forEach((cell, i) => {
				if (cell.classList.contains("bases-preview-cell")) return;
				// Use matching header as key if available
				if (headers[i]) {
					// We only pre-fill for properties that look like
					// tags / status / category (short single values)
					const text = (cell.textContent || "").trim();
					if (
						text &&
						text.length < 60 &&
						headers[i].toLowerCase() !== "name" &&
						headers[i].toLowerCase() !== "file"
					) {
						filterValues[headers[i]] = text;
					}
				}
			});
		}

		// Build frontmatter
		const yamlLines = ["---"];
		for (const [key, val] of Object.entries(filterValues)) {
			yamlLines.push(`${key}: ${val}`);
		}
		if (yamlLines.length === 1) {
			// At minimum add empty stubs for each header
			for (const h of headers) {
				if (
					h.toLowerCase() !== "name" &&
					h.toLowerCase() !== "file"
				) {
					yamlLines.push(`${h}: `);
				}
			}
		}
		yamlLines.push("---", "", "");

		const folder = this.guessFolderFromBase(table);
		const timestamp = new Date()
			.toISOString()
			.replace(/[-:T]/g, "")
			.slice(0, 14);
		const fileName = `Untitled ${timestamp}.md`;
		const filePath = normalizePath(
			folder ? `${folder}/${fileName}` : fileName
		);

		try {
			const file = await this.app.vault.create(
				filePath,
				yamlLines.join("\n")
			);
			// Open the new file
			const leaf = this.app.workspace.getLeaf(false);
			await leaf.openFile(file);
			new Notice(`Created ${file.basename}`);
		} catch (err) {
			new Notice("Failed to create note – see console");
			console.error("[bases-preview]", err);
		}
	}

	/**
	 * Best-effort guess at the folder the Base is scoped to
	 * by inspecting the Base file's own folder.
	 */
	private guessFolderFromBase(table: HTMLTableElement): string {
		const leaf = table.closest(".workspace-leaf-content");
		if (!leaf) return "";
		// Bases leaf may expose its file path
		const viewState = (leaf as HTMLElement).dataset;
		// Fallback: use the active file's folder
		const active = this.app.workspace.getActiveFile();
		if (active) {
			const parts = active.path.split("/");
			parts.pop();
			return parts.join("/");
		}
		return "";
	}

	/* ---- cleanup helpers --------------------------------------- */

	private removeInjected() {
		document
			.querySelectorAll(
				".bases-preview-cell, .bases-preview-th, .bases-preview-add-btn"
			)
			.forEach((el) => el.remove());
	}
}

/* ------------------------------------------------------------------ */
/*  Settings tab                                                      */
/* ------------------------------------------------------------------ */

class BasesPreviewSettingTab extends PluginSettingTab {
	plugin: BasesPreviewPlugin;

	constructor(app: App, plugin: BasesPreviewPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		containerEl.createEl("h2", { text: "Bases Preview Settings" });

		/* Preview length ----------------------------------------- */
		new Setting(containerEl)
			.setName("Preview length")
			.setDesc(
				"Maximum number of characters shown in the preview column."
			)
			.addText((text) =>
				text
					.setPlaceholder("200")
					.setValue(String(this.plugin.settings.previewLength))
					.onChange(async (value) => {
						const n = parseInt(value, 10);
						if (!isNaN(n) && n > 0) {
							this.plugin.settings.previewLength = n;
							await this.plugin.saveSettings();
						}
					})
			);

		/* Content source ----------------------------------------- */
		new Setting(containerEl)
			.setName("Content source")
			.setDesc(
				"Choose whether to preview the full note body or text under a specific heading."
			)
			.addDropdown((drop) =>
				drop
					.addOption("full-body", "Full body")
					.addOption("heading", "Specific heading")
					.setValue(this.plugin.settings.contentSource)
					.onChange(async (value) => {
						this.plugin.settings.contentSource = value as
							| "full-body"
							| "heading";
						await this.plugin.saveSettings();
						// Re-render to show/hide heading name field
						this.display();
					})
			);

		/* Heading name (conditional) ----------------------------- */
		if (this.plugin.settings.contentSource === "heading") {
			new Setting(containerEl)
				.setName("Heading name")
				.setDesc(
					"The heading whose content to use as the preview (case-insensitive)."
				)
				.addText((text) =>
					text
						.setPlaceholder("e.g. Summary")
						.setValue(this.plugin.settings.headingName)
						.onChange(async (value) => {
							this.plugin.settings.headingName = value.trim();
							await this.plugin.saveSettings();
						})
				);
		}

		/* Show add button ---------------------------------------- */
		new Setting(containerEl)
			.setName("Show + New note button")
			.setDesc(
				"Display a button below each Base table to quickly create a new note with matching frontmatter."
			)
			.addToggle((toggle) =>
				toggle
					.setValue(this.plugin.settings.showAddButton)
					.onChange(async (value) => {
						this.plugin.settings.showAddButton = value;
						await this.plugin.saveSettings();
					})
			);
	}
}
