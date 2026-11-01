// The YAML block at the top of a Markdown file, read as flat `key: value`
// pairs. Shared by the index (in the browser) and the ?doc plugin (in Node).
export function frontmatter(md: string) {
  const match = md.match(/^---\n([\s\S]*?)\n---\n?/);
  const data: Record<string, string> = {};
  for (const line of (match?.[1] ?? '').split('\n')) {
    const at = line.indexOf(':');
    if (at > 0)
      data[line.slice(0, at).trim()] = line
        .slice(at + 1)
        .trim()
        .replace(/^["']|["']$/g, '');
  }
  return { data, body: match ? md.slice(match[0].length) : md };
}
