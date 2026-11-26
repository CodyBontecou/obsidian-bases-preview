import {
	App,
	BasesEntry,
	BasesPropertyId,
	BasesView,
	Keymap,
	Plugin,
	PluginSettingTab,
	QueryController,
	SettingDefinitionItem,
	TFile,
	Value,
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

export const VIEW_TYPE = "bases-preview-table";

/* ------------------------------------------------------------------ */
/*  Plugin                                                            */
/* ------------------------------------------------------------------ */

/**
 * Adds a "Table with previews" view type to Bases.
 *
 * Earlier versions scraped the DOM of the built-in table view and
 * appended cells to it. Obsidian 1.15 rebuilt that table as a
 * virtualized grid of divs, so the scraping found nothing. This
 * version uses the public Bases view API (Obsidian 1.10+) instead,
 * so it no longer depends on how the built-in table is drawn.
 */
export default class BasesPreviewPlugin extends Plugin {
	settings: BasesPreviewSettings = DEFAULT_SETTINGS;

	/** Open preview views, so a settings change can re-render them. */
	readonly views = new Set<PreviewTableView>();

	async onload() {
		await this.loadSettings();
		this.addSettingTab(new BasesPreviewSettingTab(this.app, this));

		this.registerBasesView(VIEW_TYPE, {
			name: "Table with previews",
			icon: "table-properties",
			factory: (controller, containerEl) =>
				new PreviewTableView(controller, containerEl, this),
		});

		// Previews are read from note bodies, which Bases doesn't track,
		// so refresh when a note's content changes.
		this.registerEvent(
			this.app.vault.on("modify", (file) => {
				if (!(file instanceof TFile)) return;
				for (const view of this.views) view.onFileModified(file);
			})
		);
	}

	async loadSettings() {
		const saved = (await this.loadData()) as Partial<BasesPreviewSettings> | null;
		this.settings = { ...DEFAULT_SETTINGS, ...(saved ?? {}) };
	}

	async saveSettings() {
		await this.saveData(this.settings);
		for (const view of this.views) view.render();
	}

	/* ---- preview text ------------------------------------------ */

	async getPreview(file: TFile): Promise<string> {
		if (file.extension !== "md") return "";
		try {
			const body = extractBody(await this.app.vault.cachedRead(file), this.settings);
			const len = this.settings.previewLength;
			return body.length <= len ? body : body.slice(0, len).trimEnd() + "…";
		} catch {
			return "";
		}
	}
}

/* ------------------------------------------------------------------ */
/*  Bases view                                                        */
/* ------------------------------------------------------------------ */

class PreviewTableView extends BasesView {
	readonly type = VIEW_TYPE;

	private readonly rootEl: HTMLElement;
	/** Preview cells by file path, for refreshing after an edit. */
	private previewCells = new Map<string, HTMLElement[]>();
	/** Increments on each render so stale async previews are dropped. */
	private renderId = 0;

	constructor(
		controller: QueryController,
		containerEl: HTMLElement,
		private readonly plugin: BasesPreviewPlugin
	) {
		super(controller);
		this.rootEl = containerEl.createDiv("bases-preview-view");
	}

	onload() {
		this.plugin.views.add(this);
	}

	onunload() {
		this.plugin.views.delete(this);
		this.rootEl.remove();
	}

	onDataUpdated() {
		this.render();
	}

	render() {
		const renderId = ++this.renderId;
		const { rootEl } = this;
		rootEl.empty();
		this.previewCells.clear();

		const data = this.data;
		if (!data) return;

		const properties = this.config.getOrder();
		const scrollEl = rootEl.createDiv("bases-preview-scroll");
		const table = scrollEl.createEl("table", { cls: "bases-preview-table" });

		const headRow = table.createEl("thead").createEl("tr");
		for (const prop of properties) {
			headRow.createEl("th", { text: this.config.getDisplayName(prop) });
		}
		headRow.createEl("th", { cls: "bases-preview-th", text: "Preview" });

		const colCount = properties.length + 1;
		const tbody = table.createEl("tbody");
		let rowCount = 0;

		for (const group of data.groupedData) {
			if (group.hasKey() && group.key) {
				const td = tbody
					.createEl("tr", { cls: "bases-preview-group-row" })
					.createEl("td", { attr: { colspan: String(colCount) } });
				this.renderValue(td, () => group.key);
			}
			for (const entry of group.entries) {
				this.renderRow(tbody, entry, properties, renderId);
				rowCount++;
			}
		}

		if (rowCount === 0) {
			tbody
				.createEl("tr")
				.createEl("td", {
					cls: "bases-preview-empty",
					text: "No results",
					attr: { colspan: String(colCount) },
				});
		}

		if (this.plugin.settings.showAddButton) {
			const btn = rootEl.createEl("button", {
				cls: "bases-preview-add-btn",
				text: "+ New note",
				attr: { "aria-label": "Create a new note for this base" },
			});
			btn.addEventListener("click", () => {
				void this.createFileForView();
			});
		}
	}

	private renderRow(
		tbody: HTMLElement,
		entry: BasesEntry,
		properties: BasesPropertyId[],
		renderId: number
	) {
		const { file } = entry;
		const row = tbody.createEl("tr");

		for (const prop of properties) {
			const td = row.createEl("td");
			if (prop === "file.name" || prop === "file.file") {
				this.renderFileLink(td, file);
			} else {
				this.renderValue(td, () => entry.getValue(prop));
			}
		}

		const previewTd = row.createEl("td", { cls: "bases-preview-cell" });
		const cells = this.previewCells.get(file.path) ?? [];
		cells.push(previewTd);
		this.previewCells.set(file.path, cells);
		void this.fillPreview(previewTd, file, renderId);
	}

	private renderFileLink(td: HTMLElement, file: TFile) {
		const link = td.createEl("a", {
			cls: "internal-link",
			text: file.basename,
			attr: { href: file.path, "data-href": file.path },
		});
		link.addEventListener("click", (evt) => {
			evt.preventDefault();
			void this.app.workspace.openLinkText(file.path, "", Keymap.isModEvent(evt));
		});
		link.addEventListener("mouseover", (evt) => {
			this.app.workspace.trigger("hover-link", {
				event: evt,
				source: "bases",
				hoverParent: this.app.renderContext,
				targetEl: link,
				linktext: file.path,
			});
		});
	}

	private renderValue(td: HTMLElement, get: () => Value | null | undefined) {
		try {
			get()?.renderTo(td, this.app.renderContext);
		} catch {
			// A broken formula shouldn't take down the whole view.
		}
	}

	private async fillPreview(td: HTMLElement, file: TFile, renderId: number) {
		const preview = await this.plugin.getPreview(file);
		if (renderId !== this.renderId) return; // re-rendered meanwhile
		td.setText(preview);
		td.title = preview;
	}

	onFileModified(file: TFile) {
		for (const td of this.previewCells.get(file.path) ?? []) {
			void this.fillPreview(td, file, this.renderId);
		}
	}
}

/* ------------------------------------------------------------------ */
/*  Preview text extraction                                           */
/* ------------------------------------------------------------------ */

const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/;

export function extractBody(raw: string, settings: BasesPreviewSettings): string {
	const content = raw.replace(FRONTMATTER_RE, "").trim();
	if (settings.contentSource === "heading" && settings.headingName) {
		return extractHeadingSection(content, settings.headingName);
	}
	return content;
}

/** Text under a heading (any level), up to the next heading of the same or higher level. */
export function extractHeadingSection(content: string, heading: string): string {
	const result: string[] = [];
	let captureLevel = 0;

	for (const line of content.split("\n")) {
		const match = line.match(/^(#{1,6})\s+(.*)/);
		if (match) {
			const level = match[1].length;
			if (captureLevel && level <= captureLevel) break;
			if (!captureLevel && match[2].trim().toLowerCase() === heading.toLowerCase()) {
				captureLevel = level;
				continue;
			}
		}
		if (captureLevel) result.push(line);
	}

	return result.join("\n").trim();
}

/* ------------------------------------------------------------------ */
/*  Settings tab                                                      */
/* ------------------------------------------------------------------ */

class BasesPreviewSettingTab extends PluginSettingTab {
	constructor(app: App, private readonly plugin: BasesPreviewPlugin) {
		super(app, plugin);
	}

	/** Declarative settings (Obsidian 1.13+), which also makes them searchable. */
	getSettingDefinitions(): SettingDefinitionItem[] {
		const settings = this.plugin.settings;
		return [
			{
				name: "Preview length",
				desc: "Maximum number of characters shown in the preview column.",
				control: {
					type: "number",
					key: "previewLength",
					defaultValue: DEFAULT_SETTINGS.previewLength,
					min: 1,
					validate: (n) => (Number.isInteger(n) && n > 0 ? undefined : "Enter a whole number above 0."),
				},
			},
			{
				name: "Content source",
				desc: "Preview the full note body or only the text under a specific heading.",
				control: {
					type: "dropdown",
					key: "contentSource",
					defaultValue: DEFAULT_SETTINGS.contentSource,
					options: { "full-body": "Full body", heading: "Specific heading" },
				},
			},
			{
				name: "Heading name",
				desc: "The heading whose content to use as the preview (case-insensitive).",
				visible: () => settings.contentSource === "heading",
				control: { type: "text", key: "headingName", placeholder: "e.g. Summary" },
			},
			{
				name: "Show + New note button",
				desc: "Show a button below the table that creates a new note matching the base's filters.",
				control: { type: "toggle", key: "showAddButton", defaultValue: DEFAULT_SETTINGS.showAddButton },
			},
		];
	}

	getControlValue(key: string): unknown {
		return this.plugin.settings[key as keyof BasesPreviewSettings];
	}

	async setControlValue(key: string, value: unknown): Promise<void> {
		const settings = this.plugin.settings as unknown as Record<string, unknown>;
		settings[key] = key === "headingName" && typeof value === "string" ? value.trim() : value;
		await this.plugin.saveSettings();
		this.refreshDomState(); // show/hide "Heading name"
	}
}
