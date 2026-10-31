// Pixel size from an image's header, without decoding it: PNG from its IHDR
// chunk, JPEG from its first frame header. The walkthrough compiler sizes
// figures with it, and the visual match checks TypeSafe's image limits.

export type ImageSize = { width: number; height: number; format: 'png' | 'jpg' };

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const u16 = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u32 = (b: Uint8Array, i: number) =>
  ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0;

function pngSize(b: Uint8Array): ImageSize | null {
  if (b.length < 24 || PNG_SIGNATURE.some((v, i) => b[i] !== v)) return null;
  return { width: u32(b, 16), height: u32(b, 20), format: 'png' };
}

// Markers with no length field: start of image, TEM, and the restart markers.
const standalone = (m: number) => m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7);
// SOF0 to SOF15 carry the frame size, except DHT (C4), JPG (C8) and DAC (CC).
const frame = (m: number) => m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc;

function jpegSize(b: Uint8Array): ImageSize | null {
  if (b[0] !== 0xff || b[1] !== 0xd8) return null;
  let i = 2;
  while (i + 9 < b.length) {
    const marker = b[i + 1];
    // A byte that is not a marker, or 0xFF fill before one, moves on by one.
    if (b[i] !== 0xff || marker === 0xff) i += 1;
    else if (standalone(marker)) i += 2;
    else if (frame(marker)) return { height: u16(b, i + 5), width: u16(b, i + 7), format: 'jpg' };
    else i += 2 + u16(b, i + 2);
  }
  return null;
}

export const imageSize = (bytes: Uint8Array): ImageSize | null => pngSize(bytes) ?? jpegSize(bytes);
