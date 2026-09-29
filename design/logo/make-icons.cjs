// Builds the app icons from the glass rupee mark (ledger-mark.svg):
// ledger-icon.svg (the mark on its background) and the PNGs the app and
// its web manifest use. Renders with Chromium, which draws the SVG blur
// that makes the glass look frosted.
//   node design/logo/make-icons.cjs
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const dir = __dirname;
const pub = path.join(dir, "../../public");
const mark = fs.readFileSync(path.join(dir, "ledger-mark.svg"), "utf8");
const inner = mark.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "").replace(/<title>.*?<\/title>/, "");

const BACKGROUNDS = {
  light: `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#F6F8FF"/><stop offset="1" stop-color="#DCE4F8"/></linearGradient>`,
  dark: `<radialGradient id="bg" cx="0.5" cy="0.35" r="0.8"><stop offset="0" stop-color="#26324F"/><stop offset="1" stop-color="#0E1117"/></radialGradient>`,
};

/** The mark on a full-bleed background; `scale` is the mark's share of the canvas. */
function icon(bg, scale, rounded) {
  const size = 1024 * scale;
  const off = (1024 - size) / 2;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <title>Ledger</title>
  <defs>${BACKGROUNDS[bg]}</defs>
  <rect width="1024" height="1024" ${rounded ? 'rx="228"' : ""} fill="url(#bg)"/>
  <svg x="${off}" y="${off}" width="${size}" height="${size}" viewBox="0 0 1024 1024">${inner}</svg>
</svg>`;
}

async function render(page, svg, size, out) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg.replace('width="1024" height="1024"', `width="${size}" height="${size}"`)}</body></html>`);
  await page.screenshot({ path: out, omitBackground: true });
  console.log("wrote", path.relative(process.cwd(), out));
}

(async () => {
  // Dark matches the app (manifest background #0E1117); "light" is kept for other uses.
  const bg = process.argv[2] || "dark";
  const preview = process.argv[3];
  const b = await chromium.launch();
  const page = await b.newPage();
  if (preview) {
    await render(page, icon(bg, 1.15, true), 512, preview);
  } else {
    fs.writeFileSync(path.join(dir, "ledger-icon.svg"), icon(bg, 1.15, true));
    // "any" icons: the mark large, corners rounded like a phone's own.
    await render(page, icon(bg, 1.15, true), 512, path.join(pub, "icon-512.png"));
    await render(page, icon(bg, 1.15, true), 192, path.join(pub, "icon-192.png"));
    // Apple rounds the corners itself and wants a square.
    await render(page, icon(bg, 1.15, false), 180, path.join(pub, "apple-touch-icon.png"));
    // The mark alone on a transparent background, for anywhere else.
    await render(page, mark, 1024, path.join(dir, "ledger-mark.png"));
    // Maskable: square, and the mark's rounded corners inside the centre 80% safe circle.
    await render(page, icon(bg, 1.0, false), 512, path.join(pub, "icon-maskable-512.png"));
  }
  await b.close();
})();
