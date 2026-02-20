# Bases Preview — Obsidian Plugin

> Inline note content previews inside Obsidian **Bases** table rows, plus a one-click button to create new notes with matching frontmatter.

![Obsidian](https://img.shields.io/badge/Obsidian-plugin-7c3aed?style=flat-square)

---

## Features

| Feature | Description |
|---------|-------------|
| **Content preview column** | Adds a "Preview" column to every Bases table showing the first *N* characters of each linked note. |
| **Hover expand** | Hover a preview cell to see the full excerpt without leaving the table. |
| **+ New note button** | A `+ New note` button appears below each Base table. Clicking it creates a markdown file pre-populated with YAML frontmatter matching the table's column headers. |
| **Content source** | Preview the full note body (minus frontmatter) **or** text under a specific heading. |
| **Configurable length** | Set the preview length (default 200 chars) in settings. |

---

## Installation

### Manual (recommended for now)

1. Clone or download this repository.
2. Copy `main.js`, `manifest.json`, and `styles.css` into your vault's plugin folder:

   ```
   <your-vault>/.obsidian/plugins/bases-preview/
   ```

3. Reload Obsidian → **Settings → Community plugins → Bases Preview → Enable**.

### Build from source

```bash
# Install dependencies
npm install

# Development (with inline source maps)
npm run dev

# Production build
npm run build
```

The build produces `main.js` in the project root.

---

## Settings

Open **Settings → Bases Preview** to configure:

| Setting | Default | Description |
|---------|---------|-------------|
| Preview length | `200` | Max characters shown per preview cell. |
| Content source | Full body | `Full body` strips frontmatter and previews everything. `Specific heading` lets you enter a heading name — only text under that heading is previewed. |
| Heading name | *(empty)* | Shown when content source is "Specific heading". Case-insensitive match. |
| Show + New note button | `On` | Toggle the quick-add button below Base tables. |

---

## How It Works

1. **MutationObserver** watches the DOM for changes (Bases dynamically renders its table views).
2. When a Bases table is detected (via `data-type="bases"` on the workspace leaf or class heuristics), the plugin:
   - Reads each row's internal link → resolves the `TFile` via `metadataCache`.
   - Calls `vault.cachedRead()` to get the note content.
   - Strips frontmatter, optionally extracts a heading section, truncates, and injects a `<td>` cell.
3. The **+ New note** button introspects column headers and the first row's values to build YAML frontmatter for the new file.

---

## Development

```
obsidian-bases-preview/
├── main.ts            # Plugin entry point (TypeScript)
├── styles.css         # Injected styles
├── manifest.json      # Obsidian plugin manifest
├── package.json
├── tsconfig.json
├── esbuild.config.mjs # Build configuration
└── versions.json      # Obsidian version compatibility map
```

---


## Inspiration

This plugin was built in response to a request by u/tashmoo and u/DeliriumTrigger in [this Reddit thread](https://www.reddit.com/r/ObsidianMD/comments/1r8vw0w/anyone_have_a_plugin_request/) — inline note previews in Bases table rows with quick-add.

## License

MIT
