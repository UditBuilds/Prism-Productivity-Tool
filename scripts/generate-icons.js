/**
 * Generates the PWA app icons (8 sizes) into public/icons/.
 *
 * Each icon: violet gradient background (#7C3AED → #6D28D9), a bold white "P"
 * centered, with rounded corners (22% radius). Output is PNG, sized for both
 * the web manifest and iOS apple-touch-icon.
 *
 * Requires the `canvas` package (native, dev-only — not in package.json to keep
 * `npm install` from building it on every machine). To regenerate:
 *
 *   npm install canvas
 *   node scripts/generate-icons.js
 */
const fs = require("fs");
const path = require("path");
const { createCanvas } = require("canvas");

const SIZES = [72, 96, 128, 144, 152, 192, 384, 512];
const OUT_DIR = path.join(__dirname, "..", "public", "icons");

function roundedRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawIcon(size) {
  const canvas = createCanvas(size, size);
  const ctx = canvas.getContext("2d");
  const radius = size * 0.22;

  // Clip everything to the rounded square.
  roundedRect(ctx, 0, 0, size, size, radius);
  ctx.clip();

  // Violet diagonal gradient background.
  const gradient = ctx.createLinearGradient(0, 0, size, size);
  gradient.addColorStop(0, "#7C3AED");
  gradient.addColorStop(1, "#6D28D9");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  // Centered bold white "P".
  ctx.fillStyle = "#FFFFFF";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `bold ${Math.round(size * 0.6)}px Sans`;
  // Small optical nudge so the letter sits visually centered.
  ctx.fillText("P", size / 2, size / 2 + size * 0.02);

  return canvas.toBuffer("image/png");
}

fs.mkdirSync(OUT_DIR, { recursive: true });
for (const size of SIZES) {
  const buffer = drawIcon(size);
  const file = path.join(OUT_DIR, `icon-${size}.png`);
  fs.writeFileSync(file, buffer);
  console.log(`✓ ${path.relative(process.cwd(), file)} (${buffer.length} bytes)`);
}
console.log(`\nDone — ${SIZES.length} icons written to public/icons/`);
