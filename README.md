# Bases Preview — Obsidian Plugin

> A **Table with previews** view for Obsidian **Bases**: inline note content previews in each row, plus a one-click button to create new notes that match the base's filters.

Requires Obsidian 1.10.2 or later. In a base, open the view menu, choose **Add view**, and pick **Table with previews**.

![Obsidian](https://img.shields.io/badge/Obsidian-plugin-7c3aed?style=flat-square)

---

## Features

| Feature | Description |
|---------|-------------|
| **Content preview column** | The "Table with previews" view shows your base's properties plus a "Preview" column with the first *N* characters of each note. Previews refresh when a note changes. |
| **Hover expand** | Hover a preview cell to see the full excerpt without leaving the table. |
| **+ New note button** | A `+ New note` button below the table creates a note pre-filled with the properties the base filters on (for example `status: active`). |
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

The plugin registers its own view type with the public Bases API (`registerBasesView`, Obsidian 1.10+). Bases hands the view the filtered, sorted and grouped notes; the view renders each one with the configured properties, then reads the note with `vault.cachedRead()`, strips frontmatter, optionally extracts a heading section, and truncates it for the Preview column. **+ New note** uses Bases' own `createFileForView()`, so new notes match the base's filters.

Versions before 1.1.0 injected cells into the built-in table view's DOM. Obsidian 1.15 rebuilt that table, so those versions stopped showing previews.

---

## Development

```
obsidian-bases-preview/
├── main.ts            # Plugin entry point (TypeScript)
├── styles.css         # View styles
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
