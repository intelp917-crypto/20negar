/**
 * Generates the 20negar app icons (PWA / add-to-home-screen) with no external
 * dependencies — a tiny PNG encoder built on Node's zlib.
 *
 * Run with: node scripts/generate-icons.mjs
 *
 * Output: public/icons/*.png plus public/favicon.png
 */
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = join(ROOT, 'public', 'icons');

// ── PNG encoding ────────────────────────────────────────────────────────────

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([length, typeBuf, data, crc]);
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace

  // Filter byte 0 in front of each scanline.
  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0;
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Drawing helpers (supersampled for smooth edges) ─────────────────────────

const SS = 4; // supersampling factor

function mix(a, b, t) {
  return a + (b - a) * t;
}

/** Signed distance from a rounded rectangle, used for smooth edges. */
function roundedRectAlpha(px, py, x, y, w, h, r) {
  const cx = Math.min(Math.max(px, x + r), x + w - r);
  const cy = Math.min(Math.max(py, y + r), y + h - r);
  const dx = px - cx;
  const dy = py - cy;
  const dist = Math.sqrt(dx * dx + dy * dy) - r;
  return Math.min(1, Math.max(0, 0.5 - dist));
}

// 5x7 pixel glyphs for the digits we need.
const GLYPHS = {
  '2': ['01110', '10001', '00001', '00010', '00100', '01000', '11111'],
  '0': ['01110', '10001', '10001', '10001', '10001', '10001', '01110'],
};

function renderIcon(size, { maskable = false } = {}) {
  const big = size * SS;
  const buf = Buffer.alloc(big * big * 4);

  // Brand gradient: purple -> indigo (matches the app's UI).
  const from = [124, 58, 237];
  const to = [79, 70, 229];

  // Safe zone: maskable icons must keep content inside the inner 80%.
  const pad = maskable ? big * 0.04 : 0;
  const radius = maskable ? 0 : big * 0.22;

  for (let y = 0; y < big; y++) {
    for (let x = 0; x < big; x++) {
      const i = (y * big + x) * 4;
      const alpha = maskable
        ? 1
        : roundedRectAlpha(x + 0.5, y + 0.5, 0, 0, big, big, radius);

      if (alpha <= 0) {
        buf[i + 3] = 0;
        continue;
      }

      // Diagonal gradient.
      const t = (x / big + y / big) / 2;
      const r = mix(from[0], to[0], t);
      const g = mix(from[1], to[1], t);
      const b = mix(from[2], to[2], t);

      buf[i] = r;
      buf[i + 1] = g;
      buf[i + 2] = b;
      buf[i + 3] = Math.round(alpha * 255);
    }
  }

  // Draw "20" in white, centered.
  const text = '20';
  const glyphW = 5;
  const glyphH = 7;
  const gap = 1;
  const totalCols = text.length * glyphW + (text.length - 1) * gap;

  const inner = big - pad * 2;
  const cell = (inner * 0.52) / totalCols; // text occupies ~52% of the width
  const textW = totalCols * cell;
  const textH = glyphH * cell;
  const startX = (big - textW) / 2;
  const startY = (big - textH) / 2 - big * 0.06; // nudge up for the play mark

  for (let y = 0; y < big; y++) {
    for (let x = 0; x < big; x++) {
      const localX = x - startX;
      const localY = y - startY;
      if (localX < 0 || localY < 0 || localX >= textW || localY >= textH) continue;

      const col = Math.floor(localX / cell);
      const row = Math.floor(localY / cell);
      const glyphIndex = Math.floor(col / (glyphW + gap));
      const colInGlyph = col - glyphIndex * (glyphW + gap);
      if (glyphIndex >= text.length || colInGlyph >= glyphW) continue;

      const glyph = GLYPHS[text[glyphIndex]];
      if (!glyph || glyph[row][colInGlyph] !== '1') continue;

      const i = (y * big + x) * 4;
      buf[i] = 255;
      buf[i + 1] = 255;
      buf[i + 2] = 255;
      buf[i + 3] = 255;
    }
  }

  // Play triangle underneath, to signal video.
  const cy = big * 0.76;
  const cx = big / 2;
  const tri = big * 0.075;
  for (let y = 0; y < big; y++) {
    for (let x = 0; x < big; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx < -tri * 0.9 || dx > tri * 0.9) continue;
      const half = ((tri * 0.9 - dx) / (tri * 1.8)) * tri;
      if (Math.abs(dy) > half) continue;
      const i = (y * big + x) * 4;
      buf[i] = 255;
      buf[i + 1] = 255;
      buf[i + 2] = 255;
      buf[i + 3] = 255;
    }
  }

  // Downsample (box filter) back to the target size.
  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let r = 0;
      let g = 0;
      let b = 0;
      let a = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const i = ((y * SS + sy) * big + (x * SS + sx)) * 4;
          const alpha = buf[i + 3] / 255;
          r += buf[i] * alpha;
          g += buf[i + 1] * alpha;
          b += buf[i + 2] * alpha;
          a += buf[i + 3];
        }
      }
      const n = SS * SS;
      const avgA = a / n;
      const o = (y * size + x) * 4;
      // Un-premultiply so edges stay crisp.
      const wsum = a === 0 ? 1 : (a / 255) === 0 ? 1 : a / 255;
      out[o] = Math.min(255, Math.round(r / (wsum || 1)));
      out[o + 1] = Math.min(255, Math.round(g / (wsum || 1)));
      out[o + 2] = Math.min(255, Math.round(b / (wsum || 1)));
      out[o + 3] = Math.round(avgA);
    }
  }

  return encodePng(size, size, out);
}

// ── Emit files ──────────────────────────────────────────────────────────────

mkdirSync(OUT_DIR, { recursive: true });

const targets = [
  ['icon-192.png', 192, {}],
  ['icon-512.png', 512, {}],
  ['icon-maskable-192.png', 192, { maskable: true }],
  ['icon-maskable-512.png', 512, { maskable: true }],
  ['apple-touch-icon.png', 180, { maskable: true }],
];

for (const [name, size, opts] of targets) {
  writeFileSync(join(OUT_DIR, name), renderIcon(size, opts));
  console.log(`wrote public/icons/${name} (${size}x${size})`);
}

writeFileSync(join(ROOT, 'public', 'favicon.png'), renderIcon(64, {}));
console.log('wrote public/favicon.png (64x64)');
