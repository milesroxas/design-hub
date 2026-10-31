declare module '*.md?doc' {
  type Doc = import('./doc').Doc;
  export const meta: Doc['meta'];
  export const title: Doc['title'];
  export const toc: Doc['toc'];
  export const html: Doc['html'];
}
