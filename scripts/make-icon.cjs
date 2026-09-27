// Renders src/renderer/logo.svg into build/icon.png and a multi-size build/icon.ico.
// Run with: npm run icon
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const root = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'src/renderer/logo.svg'), 'utf8');
const SIZES = [16, 24, 32, 48, 64, 128, 256];

function ico(pngs) {
  const header = Buffer.alloc(6 + 16 * pngs.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(pngs.length, 4);
  let offset = header.length;
  pngs.forEach(({ size, data }, i) => {
    const e = 6 + 16 * i;
    header.writeUInt8(size >= 256 ? 0 : size, e);
    header.writeUInt8(size >= 256 ? 0 : size, e + 1);
    header.writeUInt16LE(1, e + 4);
    header.writeUInt16LE(32, e + 6);
    header.writeUInt32LE(data.length, e + 8);
    header.writeUInt32LE(offset, e + 12);
    offset += data.length;
  });
  return Buffer.concat([header, ...pngs.map((p) => p.data)]);
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  await win.loadURL('data:text/html,<html><body></body></html>');
  const svgUrl = 'data:image/svg+xml;base64,' + Buffer.from(svg).toString('base64');
  const urls = await win.webContents.executeJavaScript(`
    (async () => {
      const img = new Image();
      img.src = ${JSON.stringify(svgUrl)};
      await img.decode();
      return ${JSON.stringify(SIZES)}.map((s) => {
        const c = document.createElement('canvas');
        c.width = c.height = s;
        const ctx = c.getContext('2d');
        ctx.imageSmoothingQuality = 'high';
        ctx.drawImage(img, 0, 0, s, s);
        return c.toDataURL('image/png');
      });
    })()
  `);
  const pngs = urls.map((u, i) => ({ size: SIZES[i], data: Buffer.from(u.split(',')[1], 'base64') }));
  const out = path.join(root, 'build');
  fs.mkdirSync(out, { recursive: true });
  fs.writeFileSync(path.join(out, 'icon.png'), pngs[pngs.length - 1].data);
  fs.writeFileSync(path.join(out, 'icon.ico'), ico(pngs));
  console.log('Wrote build/icon.png and build/icon.ico');
  app.quit();
});
