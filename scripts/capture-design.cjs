// npm run capture:design [-- <design.html> <out dir>]
// Screenshots each board of the exported design (screens and the token set)
// into PNGs, to compare with `npm run capture`. Runs in Electron so both
// render with the same Chromium.
const { app, BrowserWindow } = require('electron');
const { mkdirSync, writeFileSync } = require('node:fs');
const path = require('node:path');

const [designFile = 'design/Grimoire.html', outDir = 'design/captures'] = process.argv.slice(2);
const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Pixel-for-pixel, whatever the screen's scaling.
app.commandLine.appendSwitch('force-device-scale-factor', '1');

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 2016,
    height: 2600,
    useContentSize: true,
    enableLargerThanScreen: true,
    show: false,
    // Offscreen rendering keeps painting while hidden and isn't limited to the screen size.
    webPreferences: { sandbox: true, contextIsolation: true, offscreen: true },
  });
  await win.loadFile(path.resolve(designFile));
  // The export unpacks itself and its fonts after load.
  await delay(6000);

  const boards = await win.webContents.executeJavaScript(
    `[...document.querySelectorAll('.board')].map((b) => b.querySelector('h2')?.textContent ?? '')`,
  );
  mkdirSync(outDir, { recursive: true });
  for (const [index, title] of boards.entries()) {
    const rect = await win.webContents.executeJavaScript(`(() => {
      const frame = document.querySelectorAll('.board iframe')[${index}];
      frame.scrollIntoView({ block: 'start' });
      const r = frame.getBoundingClientRect();
      return { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height) };
    })()`);
    await delay(500);
    const image = await win.webContents.capturePage(rect);
    const name = `${String(index + 1).padStart(2, '0')}-${title
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '')}.png`;
    writeFileSync(path.join(outDir, name), image.toPNG());
    console.log(`${name} ${image.getSize().width}×${image.getSize().height}`);
  }
  app.exit(0);
});
