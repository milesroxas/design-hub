// What a compiled walkthrough looks like to the browser. The compiler
// (markdown.ts) runs only at build time, so the page imports this shape, never
// the compiler.
export type TocEntry = { id: string; text: string; depth: number };
export type Doc = { meta: Record<string, string>; title: string; toc: TocEntry[]; html: string };
