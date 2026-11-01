// What a compiled walkthrough looks like: the shape the Vite plugin writes at
// build time (vite/markdown.ts) and the page reads (shell/Guide.tsx).
export type TocEntry = { id: string; text: string; depth: number };
export type Doc = { meta: Record<string, string>; title: string; toc: TocEntry[]; html: string };
