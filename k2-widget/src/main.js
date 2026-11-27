const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeImage, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { Printer } = require('./printer');
const { discover } = require('./discover');

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

const SIZE = { compact: { w: 400, h: 104 }, expanded: { w: 400, h: 600 } };
const DEFAULTS = {
  ip: '',
  autostart: true,
  alwaysShow: false,
  fans: [
    { name: 'Обдув модели', index: 0, key: 'modelFanPct' },
    { name: 'Боковой (AUX)', index: 2, key: 'auxiliaryFanPct' },
    { name: 'Камера / корпус', index: 1, key: 'caseFanPct' },
  ],
  pos: null,
};

let cfgPath, cfg;
function loadCfg() {
  cfgPath = path.join(app.getPath('userData'), 'config.json');
  try { cfg = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(cfgPath, 'utf8')) }; }
  catch (_) { cfg = { ...DEFAULTS }; }
}
function saveCfg() {
  try { fs.mkdirSync(path.dirname(cfgPath), { recursive: true }); fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2)); } catch (_) {}
}

let win, tray;
const printer = new Printer();
let mode = 'compact';
let wasActive = false;
let hiddenByUser = false;
let hideTimer = null;
let objectsFromFile = [];
const excluded = new Set();

function isActive(s) {
  const st = Number(s.state);
  if (st === 1 || st === 5) return true;
  const p = Number(s.printProgress);
  return !!s.printFileName && p > 0 && p < 100 && st !== 2 && st !== 3 && st !== 4;
}

function placeWindow() {
  const { w, h } = SIZE[mode];
  const wa = screen.getPrimaryDisplay().workArea;
  let right = wa.x + wa.width - 16, bottom = wa.y + wa.height - 16;
  if (cfg.pos) {
    // Запоминаем правый нижний угол — окно растёт вверх, как плеер
    const d = screen.getDisplayNearestPoint({ x: cfg.pos.right - 10, y: cfg.pos.bottom - 10 }).workArea;
    right = Math.min(Math.max(cfg.pos.right, d.x + w), d.x + d.width);
    bottom = Math.min(Math.max(cfg.pos.bottom, d.y + h), d.y + d.height);
  }
  win.setBounds({ x: Math.round(right - w), y: Math.round(bottom - h), width: w, height: h });
}

function createWindow() {
  win = new BrowserWindow({
    width: SIZE.compact.w, height: SIZE.compact.h,
    frame: false, transparent: true, resizable: false, maximizable: false, minimizable: false,
    alwaysOnTop: true, skipTaskbar: true, show: false, hasShadow: false, focusable: true,
    backgroundColor: '#00000000',
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false },
  });
  win.setAlwaysOnTop(true, 'floating');
  win.loadFile(path.join(__dirname, 'ui', 'index.html'));
  placeWindow();
  let moveT;
  win.on('moved', () => {
    clearTimeout(moveT);
    moveT = setTimeout(() => {
      const b = win.getBounds();
      cfg.pos = { right: b.x + b.width, bottom: b.y + b.height };
      saveCfg();
    }, 300);
  });
  win.webContents.on('did-finish-load', () => {
    push();
    if (!cfg.ip || cfg.alwaysShow) showWidget(true);
  });
}

function showWidget(force) {
  if (!win) return;
  if (!force && hiddenByUser) return;
  clearTimeout(hideTimer);
  if (!win.isVisible()) win.showInactive();
}
function hideWidget() { if (win) win.hide(); }

function push() {
  if (!win || win.isDestroyed()) return;
  win.webContents.send('update', {
    connected: printer.connected,
    ip: cfg.ip,
    state: printer.state,
    cfg: { fans: cfg.fans, autostart: cfg.autostart, alwaysShow: cfg.alwaysShow },
    mode,
    objects: collectObjects(),
  });
}

function collectObjects() {
  let names = [];
  const s = printer.state;
  for (const [k, v] of Object.entries(s)) {
    if (!/object/i.test(k) || !Array.isArray(v)) continue;
    for (const o of v) {
      const n = typeof o === 'string' ? o : (o && (o.name || o.objName || o.NAME));
      if (n) names.push(String(n));
    }
  }
  if (!names.length) names = objectsFromFile;
  return [...new Set(names)].map((n) => ({ name: n, excluded: excluded.has(n) }));
}

function parseGcodeObjects(text) {
  const names = new Set();
  const re = /^(?:EXCLUDE_OBJECT_DEFINE|EXCLUDE_OBJECT_START)\s+NAME=(\S+)/gim;
  let m;
  while ((m = re.exec(text))) names.add(m[1].replace(/^['"]|['"]$/g, ''));
  return [...names];
}

printer.on('connection', () => { updateTray(); push(); });
let lastFile = null;
printer.on('state', (s) => {
  if (s.printFileName !== lastFile) {
    lastFile = s.printFileName;
    excluded.clear();
    objectsFromFile = [];
  }
  const active = isActive(s);
  if (active && !wasActive) { hiddenByUser = false; showWidget(); }
  if (!active && wasActive && !cfg.alwaysShow) {
    // Печать закончилась — показываем итог минуту, потом прячемся в трей
    clearTimeout(hideTimer);
    hideTimer = setTimeout(hideWidget, 60000);
  }
  wasActive = active;
  push();
});
setInterval(push, 1000); // тикаем таймеры даже если принтер ничего не прислал

function makeIcon() {
  const f = path.join(__dirname, 'ui', 'icon.png');
  const img = nativeImage.createFromPath(f);
  return img.isEmpty() ? nativeImage.createEmpty() : img.resize({ width: 16, height: 16 });
}

function updateTray() {
  if (!tray) return;
  tray.setToolTip(`K2 Widget — ${printer.connected ? 'принтер на связи (' + cfg.ip + ')' : 'нет связи с принтером'}`);
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: printer.connected ? `● На связи: ${cfg.ip}` : '○ Нет связи', enabled: false },
    { type: 'separator' },
    { label: 'Показать виджет', click: () => { hiddenByUser = false; showWidget(true); } },
    { label: 'Скрыть виджет', click: () => { hiddenByUser = true; hideWidget(); } },
    { label: 'Настройки', click: () => { hiddenByUser = false; showWidget(true); win.webContents.send('open-settings'); } },
    { type: 'separator' },
    { label: 'Сохранить лог принтера (для отладки)', click: saveLog },
    { label: 'Выход', click: () => { app.isQuitting = true; app.quit(); } },
  ]));
}

async function saveLog() {
  const r = await dialog.showSaveDialog({ defaultPath: path.join(app.getPath('desktop'), 'k2-log.json') });
  if (r.canceled || !r.filePath) return;
  fs.writeFileSync(r.filePath, JSON.stringify({ ip: cfg.ip, state: printer.state, log: printer.rawLog }, null, 2));
  shell.showItemInFolder(r.filePath);
}

function applyAutostart() {
  if (process.platform === 'win32' || process.platform === 'darwin') {
    app.setLoginItemSettings({ openAtLogin: !!cfg.autostart, args: ['--hidden'] });
  }
}

// ---- команды из интерфейса ----
ipcMain.handle('cmd', async (_e, c) => {
  switch (c.type) {
    case 'pause': return printer.pause();
    case 'resume': return printer.resume();
    case 'stop': return printer.stop();
    case 'speed': return printer.speed(c.value);
    case 'fan': return printer.fan(c.index, c.value);
    case 'exclude': {
      const ok = printer.excludeObject(c.name);
      if (ok) excluded.add(c.name);
      push();
      return ok;
    }
    case 'mode':
      mode = c.value === 'expanded' ? 'expanded' : 'compact';
      placeWindow();
      push();
      return true;
    case 'hide': hiddenByUser = true; hideWidget(); return true;
    case 'setIp':
      cfg.ip = String(c.value || '').trim();
      saveCfg();
      if (cfg.ip) printer.connect(cfg.ip); else printer.disconnect();
      updateTray(); push();
      return true;
    case 'setCfg':
      Object.assign(cfg, c.value);
      saveCfg(); applyAutostart(); push();
      return true;
    case 'discover': {
      const found = await discover((p) => win && win.webContents.send('scan-progress', p));
      return found;
    }
    case 'loadGcode': {
      const r = await dialog.showOpenDialog(win, { filters: [{ name: 'G-code', extensions: ['gcode', 'gco', 'g'] }], properties: ['openFile'] });
      if (r.canceled || !r.filePaths[0]) return 0;
      objectsFromFile = parseGcodeObjects(fs.readFileSync(r.filePaths[0], 'utf8'));
      push();
      return objectsFromFile.length;
    }
    case 'gcodeText':
      objectsFromFile = parseGcodeObjects(c.value || '');
      push();
      return objectsFromFile.length;
  }
  return false;
});

app.whenReady().then(() => {
  loadCfg();
  applyAutostart();
  createWindow();
  tray = new Tray(makeIcon());
  tray.on('click', () => {
    if (win.isVisible()) { hiddenByUser = true; hideWidget(); }
    else { hiddenByUser = false; showWidget(true); }
  });
  updateTray();
  if (cfg.ip) printer.connect(cfg.ip);
  screen.on('display-metrics-changed', placeWindow);
});

app.on('second-instance', () => { hiddenByUser = false; showWidget(true); });
app.on('window-all-closed', (e) => e.preventDefault());

module.exports = { parseGcodeObjects };
