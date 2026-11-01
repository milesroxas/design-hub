# Docs

Written documentation for the project's design work. This folder is also an Obsidian vault: open `docs/` in Obsidian to edit here, or edit the Markdown in any editor. Git is the sync.

## Layout

| Folder | What goes there |
| --- | --- |
| `sprints/<feature>/` | One feature's working documents: `design-doc.md`, `guide.md` (the walkthrough reviewers follow), `port.md` (the port report `miles-port` writes), the exploration it set aside under `archive/`, and `assets/` for the figures only these documents embed. The folder name is the feature's slug, the same one its prototypes use. |
| `research/` | Product walkthroughs, meeting notes, findings. |
| `assets/` | Product screenshots and other figures more than one document embeds. |

## Conventions

- Standard Markdown links and images (`[text](path.md)`, `![alt](assets/x.jpg)`), not wikilinks, so GitHub and other editors render them. The vault settings in `.obsidian/app.json` enforce this for new links.
- Callouts use the GitHub alert syntax: `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`, `> [!WARNING]`, `> [!CAUTION]`. Obsidian renders the same markers.
- Diagrams go in fenced `mermaid` blocks. Charts go in `assets/` as SVG and are embedded as images.
- `.obsidian/workspace*.json` is ignored; the rest of `.obsidian/` is committed.
- Every `sprints/<feature>/guide.md` is also a page on the prototypes site, at `/guide/<feature>/`: the build compiles the Markdown and its images, so an edit here is the edit there, and a new guide needs no wiring `pnpm guide <feature>` starts one.
