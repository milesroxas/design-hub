// Bytes to text, and SHA-256, on Web Crypto only, so the same helpers serve
// the browser, Node and Vercel's runtime.

export async function sha256(text: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text)));
}

export const hex = (bytes: Uint8Array) => Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');

export const base64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

/** URL-safe base64 without padding: cookies, tokens and links carry it unescaped. */
export const base64url = (bytes: Uint8Array) =>
  base64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '');
