// Aurelia — a travel poster for a place that isn't there.
//
// main.ts (Node 22, standard library only, no network) draws one
// 1024x1024 travel poster for AURELIA, a city that floats above a sea
// of clouds, and writes it to /output/entry.png. The picture is fully
// deterministic: the same bytes on every run.
//
// The poster is drawn in code: a sunset sky, a golden sun, a sea of
// clouds, three floating islands with a beacon tower, hot-air balloons,
// and a navy title band with the place name set in a bitmap font that
// this file defines itself, plus its own PNG encoder.

import { deflateSync } from "node:zlib";
import { mkdirSync, writeFileSync } from "node:fs";

const W = 1024;
const H = 1024;

// ---------------------------------------------------------------------------
// Small deterministic PRNG (mulberry32) so any jitter is identical each run.
// ---------------------------------------------------------------------------
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261121);

// ---------------------------------------------------------------------------
// Colour helpers. A colour is [r, g, b], each 0..255.
// ---------------------------------------------------------------------------
type RGB = [number, number, number];

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

function mix(c1: RGB, c2: RGB, t: number): RGB {
  return [
    Math.round(lerp(c1[0], c2[0], t)),
    Math.round(lerp(c1[1], c2[1], t)),
    Math.round(lerp(c1[2], c2[2], t)),
  ];
}

// A gradient stop list; sample(t) walks the stops for 0 <= t <= 1.
function gradient(stops: Array<[number, RGB]>): (t: number) => RGB {
  return (t: number) => {
    if (t <= stops[0][0]) return stops[0][1];
    for (let i = 1; i < stops.length; i++) {
      if (t <= stops[i][0]) {
        const [t0, c0] = stops[i - 1];
        const [t1, c1] = stops[i];
        return mix(c0, c1, (t - t0) / (t1 - t0));
      }
    }
    return stops[stops.length - 1][1];
  };
}

// ---------------------------------------------------------------------------
// Canvas: a plain RGB buffer with alpha-blended drawing primitives.
// ---------------------------------------------------------------------------
class Canvas {
  readonly w = W;
  readonly h = H;
  readonly px = new Uint8Array(W * H * 3);

  private idx(x: number, y: number): number {
    return (y * W + x) * 3;
  }

  set(x: number, y: number, c: RGB): void {
    if (x < 0 || y < 0 || x >= W || y >= H) return;
    const i = this.idx(x, y);
    this.px[i] = c[0];
    this.px[i + 1] = c[1];
    this.px[i + 2] = c[2];
  }

  // Blend colour c over the pixel with opacity a (0..1).
  blend(x: number, y: number, c: RGB, a: number): void {
    if (a <= 0 || x < 0 || y < 0 || x >= W || y >= H) return;
    if (a >= 1) return this.set(x, y, c);
    const i = this.idx(x, y);
    this.px[i] = Math.round(this.px[i] + (c[0] - this.px[i]) * a);
    this.px[i + 1] = Math.round(this.px[i + 1] + (c[1] - this.px[i + 1]) * a);
    this.px[i + 2] = Math.round(this.px[i + 2] + (c[2] - this.px[i + 2]) * a);
  }

  rect(x0: number, y0: number, x1: number, y1: number, c: RGB): void {
    for (let y = Math.max(0, y0); y <= Math.min(H - 1, y1); y++) {
      for (let x = Math.max(0, x0); x <= Math.min(W - 1, x1); x++) {
        this.set(x, y, c);
      }
    }
  }

  // Filled circle.
  disc(cx: number, cy: number, r: number, c: RGB, a = 1): void {
    const r2 = r * r;
    for (let y = Math.floor(cy - r); y <= Math.ceil(cy + r); y++) {
      for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= r2) this.blend(x, y, c, a);
      }
    }
  }

  // Filled ellipse.
  ellipse(cx: number, cy: number, rx: number, ry: number, c: RGB, a = 1): void {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
      for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
        const dx = (x - cx) / rx;
        const dy = (y - cy) / ry;
        if (dx * dx + dy * dy <= 1) this.blend(x, y, c, a);
      }
    }
  }

  // Bresenham line with a square brush of the given half-width.
  line(x0: number, y0: number, x1: number, y1: number, c: RGB, hw = 0, a = 1): void {
    const dx = Math.abs(x1 - x0);
    const dy = -Math.abs(y1 - y0);
    const sx = x0 < x1 ? 1 : -1;
    const sy = y0 < y1 ? 1 : -1;
    let err = dx + dy;
    let x = x0;
    let y = y0;
    for (;;) {
      for (let oy = -hw; oy <= hw; oy++) {
        for (let ox = -hw; ox <= hw; ox++) this.blend(x + ox, y + oy, c, a);
      }
      if (x === x1 && y === y1) break;
      const e2 = 2 * err;
      if (e2 >= dy) {
        err += dy;
        x += sx;
      }
      if (e2 <= dx) {
        err += dx;
        y += sy;
      }
    }
  }

  // Filled triangle.
  triangle(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, c: RGB, a = 1): void {
    const minX = Math.floor(Math.min(ax, bx, cx));
    const maxX = Math.ceil(Math.max(ax, bx, cx));
    const minY = Math.floor(Math.min(ay, by, cy));
    const maxY = Math.ceil(Math.max(ay, by, cy));
    const d = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
    if (d === 0) return;
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const s = ((bx - ax) * (y - ay) - (by - ay) * (x - ax)) / d;
        const t = ((cx - ax) * (y - ay) - (cy - ay) * (x - ax)) / -d;
        if (s >= 0 && t >= 0 && s + t <= 1) this.blend(x, y, c, a);
      }
    }
  }

  // Vertical gradient fill over a rectangle.
  vgrad(x0: number, y0: number, x1: number, y1: number, g: (t: number) => RGB): void {
    for (let y = y0; y <= y1; y++) {
      const c = g((y - y0) / Math.max(1, y1 - y0));
      for (let x = x0; x <= x1; x++) this.set(x, y, c);
    }
  }
}

// ---------------------------------------------------------------------------
// PNG encoder: 8-bit RGB, filter 0, zlib-compressed IDAT.
// ---------------------------------------------------------------------------
const CRC_TABLE: Uint32Array = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }
  return table;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const out = Buffer.alloc(12 + data.length);
  out.writeUInt32BE(data.length, 0);
  out.write(type, 4, 4, "ascii");
  data.copy(out, 8);
  out.writeUInt32BE(crc32(Buffer.concat([Buffer.from(type, "ascii"), data])), 8 + data.length);
  return out;
}

function encodePng(cv: Canvas): Buffer {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(W, 0);
  ihdr.writeUInt32BE(H, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 2; // colour type RGB
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.alloc(H * (1 + W * 3));
  for (let y = 0; y < H; y++) {
    raw[y * (1 + W * 3)] = 0; // filter: none
    Buffer.from(cv.px.buffer, y * W * 3, W * 3).copy(raw, y * (1 + W * 3) + 1);
  }
  const idat = deflateSync(raw, { level: 9 });
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", idat),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------------------------------------------------------------------------
// Bitmap font: 5 wide, 7 tall. Each glyph is 7 rows; each row is a 5-bit
// number, bit 4 = leftmost pixel. Drawn by hand for this poster.
// ---------------------------------------------------------------------------
const FONT: Record<string, number[]> = {
  A: [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  B: [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
  C: [0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110],
  D: [0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110],
  E: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
  F: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
  G: [0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01111],
  H: [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  I: [0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  J: [0b00111, 0b00010, 0b00010, 0b00010, 0b00010, 0b10010, 0b01100],
  K: [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
  L: [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
  M: [0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001],
  N: [0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001],
  O: [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  P: [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
  Q: [0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101],
  R: [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
  S: [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110],
  T: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  U: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  V: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
  W: [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b11011, 0b10001],
  X: [0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001],
  Y: [0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100],
  Z: [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111],
  "0": [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  "1": [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  "2": [0b01110, 0b10001, 0b00001, 0b00110, 0b01000, 0b10000, 0b11111],
  "3": [0b11111, 0b00010, 0b00100, 0b00010, 0b00001, 0b10001, 0b01110],
  "4": [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
  "5": [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  "6": [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  "7": [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  "8": [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  "9": [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100],
  " ": [0, 0, 0, 0, 0, 0, 0],
  ".": [0, 0, 0, 0, 0, 0b01100, 0b01100],
  ",": [0, 0, 0, 0, 0b01100, 0b00100, 0b01000],
  "'": [0b00100, 0b00100, 0b01000, 0, 0, 0, 0],
  "-": [0, 0, 0, 0b01110, 0, 0, 0],
  "\u2014": [0, 0, 0, 0b11111, 0, 0, 0],
  "\u00b7": [0, 0, 0b00100, 0b01110, 0b01110, 0b00100, 0],
  "/": [0b00001, 0b00010, 0b00010, 0b00100, 0b01000, 0b01000, 0b10000],
  ":": [0, 0b01100, 0b01100, 0, 0b01100, 0b01100, 0],
};

const GLYPH_W = 5;
const GLYPH_H = 7;

function textWidth(text: string, scale: number): number {
  return text.length * (GLYPH_W + 1) * scale - scale;
}

function drawText(cv: Canvas, text: string, x: number, y: number, scale: number, c: RGB): void {
  let cx = x;
  for (const ch of text) {
    const glyph = FONT[ch] ?? FONT[" "]!;
    for (let row = 0; row < GLYPH_H; row++) {
      const bits = glyph[row]!;
      for (let col = 0; col < GLYPH_W; col++) {
        if (bits & (1 << (GLYPH_W - 1 - col))) {
          cv.rect(
            cx + col * scale,
            y + row * scale,
            cx + col * scale + scale - 1,
            y + row * scale + scale - 1,
            c,
          );
        }
      }
    }
    cx += (GLYPH_W + 1) * scale;
  }
}

function drawTextCentered(cv: Canvas, text: string, cx: number, y: number, scale: number, c: RGB): void {
  drawText(cv, text, cx - Math.floor(textWidth(text, scale) / 2), y, scale, c);
}

// ---------------------------------------------------------------------------
// Palette.
// ---------------------------------------------------------------------------
const NAVY: RGB = [16, 28, 61];
const GOLD: RGB = [246, 196, 83];
const CREAM: RGB = [247, 234, 209];
const SUN_CORE: RGB = [255, 217, 122];
const SUN_GLOW: RGB = [255, 179, 71];
const ROCK: RGB = [74, 63, 102];
const ROCK_DARK: RGB = [52, 44, 78];
const ROCK_RIM: RGB = [232, 165, 107];
const WALL: RGB = [224, 158, 102];
const WALL_DARK: RGB = [188, 120, 78];
const DOME: RGB = [122, 46, 77];
const WINDOW_LIT: RGB = [255, 217, 122];

// ---------------------------------------------------------------------------
// The sky: a sunset gradient from deep indigo down to gold at the horizon.
// ---------------------------------------------------------------------------
function drawSky(cv: Canvas): void {
  const sky = gradient([
    [0.0, [27, 42, 74]],
    [0.3, [74, 62, 110]],
    [0.55, [150, 84, 122]],
    [0.75, [214, 110, 96]],
    [1.0, [245, 166, 90]],
  ]);
  cv.vgrad(0, 0, W - 1, 700, sky);
}

// The sun: a bright disc with a soft halo of fading rings.
function drawSun(cv: Canvas): void {
  const cx = 512;
  const cy = 470;
  for (let r = 190; r > 86; r -= 4) {
    const a = 0.05 + 0.16 * (1 - (r - 86) / 104);
    cv.disc(cx, cy, r, SUN_GLOW, Math.min(0.22, a));
  }
  cv.disc(cx, cy, 86, SUN_CORE);
  cv.disc(cx, cy - 8, 70, [255, 228, 150]);
}

// A puffy cloud made of overlapping ellipses, lit on top, shaded below.
function cloud(cv: Canvas, cx: number, cy: number, s: number, lit: RGB, shade: RGB): void {
  const puffs: Array<[number, number, number, number]> = [
    [0, 0, 1.0, 0.55],
    [-0.85, 0.12, 0.7, 0.45],
    [0.85, 0.12, 0.72, 0.46],
    [-1.5, 0.28, 0.5, 0.36],
    [1.5, 0.28, 0.52, 0.36],
    [-0.4, -0.3, 0.55, 0.4],
    [0.45, -0.28, 0.5, 0.38],
  ];
  for (const [dx, dy, rx, ry] of puffs) {
    cv.ellipse(cx + dx * s, cy + dy * s + 6, rx * s, ry * s, shade, 0.9);
  }
  for (const [dx, dy, rx, ry] of puffs) {
    cv.ellipse(cx + dx * s, cy + dy * s, rx * s, ry * s, lit, 0.95);
  }
}

// The sea of clouds the city floats above.
function drawCloudSea(cv: Canvas): void {
  const lit: RGB = [255, 227, 194];
  const shade: RGB = [196, 138, 158];
  const spots: Array<[number, number, number]> = [
    [120, 660, 150], [330, 700, 180], [560, 665, 170], [790, 705, 185], [960, 660, 140],
    [210, 730, 160], [470, 745, 190], [700, 740, 170], [900, 735, 150],
  ];
  for (const [x, y, s] of spots) cloud(cv, x, y, s, lit, shade);
  // A soft floor so the band below meets the clouds cleanly.
  cv.rect(0, 760, W - 1, 782, [238, 178, 160]);
}

// ---------------------------------------------------------------------------
// Floating islands: a rock underside, flat grassy top, towers on top.
// ---------------------------------------------------------------------------
function islandRock(cv: Canvas, cx: number, topY: number, halfW: number, depth: number): void {
  // Flat top, tapering underside that narrows to a point.
  const steps = 26;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = topY + t * depth;
    const w = halfW * (1 - t * t * 0.92);
    const c = mix(ROCK, ROCK_DARK, t);
    cv.rect(Math.round(cx - w), Math.round(y), Math.round(cx + w), Math.round(y + depth / steps), c);
  }
  // Warm rim light along the top edge.
  cv.rect(Math.round(cx - halfW), topY, Math.round(cx + halfW), topY + 3, ROCK_RIM);
  // A few pale streaks on the rock face.
  for (let i = 0; i < 5; i++) {
    const x = cx - halfW * 0.7 + rnd() * halfW * 1.4;
    const y = topY + 12 + rnd() * depth * 0.55;
    cv.line(Math.round(x), Math.round(y), Math.round(x + 8), Math.round(y + 26), [120, 100, 140], 1, 0.55);
  }
}

function tower(cv: Canvas, x: number, baseY: number, w: number, h: number, domed: boolean): void {
  cv.rect(x, baseY - h, x + w, baseY, WALL);
  cv.rect(x, baseY - h, x + 3, baseY, WALL_DARK);
  // Lit windows in a column.
  const floors = Math.floor(h / 34);
  for (let f = 0; f < floors; f++) {
    const wy = baseY - 22 - f * 34;
    cv.rect(x + Math.floor(w / 2) - 4, wy, x + Math.floor(w / 2) + 4, wy + 12, WINDOW_LIT);
  }
  if (domed) {
    cv.ellipse(x + w / 2, baseY - h, w * 0.62, w * 0.5, DOME);
    cv.rect(x + Math.floor(w / 2) - 2, baseY - h - Math.floor(w * 0.5) - 8, x + Math.floor(w / 2) + 2, baseY - h, GOLD);
    cv.disc(x + w / 2, baseY - h - Math.floor(w * 0.5) - 10, 5, GOLD);
  } else {
    cv.triangle(x - 4, baseY - h, x + w + 4, baseY - h, x + w / 2, baseY - h - Math.floor(w * 0.75), DOME);
  }
}

// The Beacon of Aurelia: the city's tall lighthouse tower, beam pointing up.
function beacon(cv: Canvas): void {
  const cx = 512;
  const baseY = 596;
  const topY = 236;
  // Beam: a translucent golden wedge rising from the lamp into the sky.
  for (let y = 60; y < topY; y++) {
    const t = (topY - y) / (topY - 60);
    const half = 8 + t * 48;
    const a = 0.75 * (1 - t * 0.45);
    for (let x = Math.round(cx - half); x <= Math.round(cx + half); x++) {
      cv.blend(x, y, [255, 205, 90], a);
    }
  }
  // Tower body, slightly tapering.
  const steps = 40;
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const y = topY + t * (baseY - topY);
    const half = 34 - t * 10;
    cv.rect(Math.round(cx - half), Math.round(y), Math.round(cx + half), Math.round(y + (baseY - topY) / steps), WALL);
  }
  cv.rect(cx - 34, topY, cx - 28, baseY, WALL_DARK);
  // Balconies.
  for (const by of [320, 420, 510]) {
    cv.rect(cx - 44, by, cx + 44, by + 7, DOME);
  }
  // Lamp room and dome.
  cv.rect(cx - 26, topY - 34, cx + 26, topY, WINDOW_LIT);
  cv.ellipse(cx, topY - 34, 34, 24, DOME);
  cv.disc(cx, topY - 62, 7, GOLD);
  cv.disc(cx, topY - 62, 16, SUN_GLOW, 0.5);
  // Windows down the tower.
  for (let wy = topY + 30; wy < baseY - 20; wy += 34) {
    cv.rect(cx - 5, wy, cx + 5, wy + 12, WINDOW_LIT);
  }
}

function drawIslands(cv: Canvas): void {
  // Left island: two spired towers.
  islandRock(cv, 248, 560, 118, 92);
  tower(cv, 196, 560, 34, 96, false);
  tower(cv, 246, 560, 42, 128, true);
  tower(cv, 296, 560, 30, 78, false);

  // Right island: a domed hall and a spire.
  islandRock(cv, 788, 548, 126, 98);
  tower(cv, 716, 548, 40, 108, true);
  tower(cv, 772, 548, 46, 140, true);
  tower(cv, 828, 548, 32, 84, false);

  // Central island carries the Beacon.
  islandRock(cv, 512, 596, 150, 110);
  beacon(cv);
}

// Hot-air balloons drifting above the city.
function balloon(cv: Canvas, cx: number, cy: number, s: number, c1: RGB, c2: RGB): void {
  cv.ellipse(cx, cy, 34 * s, 40 * s, c1);
  cv.ellipse(cx, cy, 18 * s, 40 * s, c2);
  cv.ellipse(cx, cy, 6 * s, 40 * s, c1);
  cv.line(Math.round(cx - 16 * s), Math.round(cy + 38 * s), Math.round(cx - 10 * s), Math.round(cy + 56 * s), [60, 40, 60], 1);
  cv.line(Math.round(cx + 16 * s), Math.round(cy + 38 * s), Math.round(cx + 10 * s), Math.round(cy + 56 * s), [60, 40, 60], 1);
  cv.rect(Math.round(cx - 11 * s), Math.round(cy + 56 * s), Math.round(cx + 11 * s), Math.round(cy + 70 * s), [90, 60, 50]);
}

// A few birds as small dark chevrons.
function birds(cv: Canvas): void {
  const flock: Array<[number, number, number]> = [
    [330, 250, 10], [368, 232, 8], [392, 262, 7],
    [660, 210, 9], [700, 228, 7], [724, 196, 8],
  ];
  for (const [x, y, s] of flock) {
    cv.line(x - s, y, x, y - Math.floor(s * 0.6), [40, 32, 56], 1);
    cv.line(x, y - Math.floor(s * 0.6), x + s, y, [40, 32, 56], 1);
  }
}

// ---------------------------------------------------------------------------
// Title band: navy, gold rules, the place name big, tagline, small line.
// ---------------------------------------------------------------------------
function drawBand(cv: Canvas): void {
  cv.rect(0, 782, W - 1, H - 1, NAVY);
  cv.rect(0, 782, W - 1, 786, GOLD);
  cv.rect(88, 812, W - 89, 815, GOLD);
  drawTextCentered(cv, "AURELIA", 512, 834, 13, GOLD);
  drawTextCentered(cv, "THE CITY ABOVE THE CLOUDS", 512, 946, 4, CREAM);
  cv.rect(88, 988, W - 89, 991, GOLD);
  drawTextCentered(cv, "SKYHARBOUR \u00b7 ARRIVE BY BALLOON \u00b7 SUNSET ALL YEAR", 512, 1002, 2, [190, 200, 220]);
}

// ---------------------------------------------------------------------------
// Assemble the poster and write it.
// ---------------------------------------------------------------------------
function drawPoster(): Canvas {
  const cv = new Canvas();
  drawSky(cv);
  drawSun(cv);
  birds(cv);
  balloon(cv, 168, 296, 0.9, [214, 84, 96], CREAM);
  balloon(cv, 868, 318, 0.75, [84, 140, 190], GOLD);
  drawCloudSea(cv);
  drawIslands(cv);
  drawBand(cv);
  return cv;
}

function main(): void {
  const out = process.argv[2] ?? "/output/entry.png";
  const png = encodePng(drawPoster());
  mkdirSync(out.split("/").slice(0, -1).join("/") || ".", { recursive: true });
  writeFileSync(out, png);
  console.log(`wrote ${out} (${png.length} bytes)`);
}

main();
