// Поиск принтера в локальной сети: стучимся в порт 9999 на всех адресах своей подсети /24,
// затем проверяем, что там реально отвечает принтер (присылает JSON).
const net = require('net');
const os = require('os');
const WebSocket = require('ws');
const { PORT } = require('./printer');

function localPrefixes() {
  const out = new Set();
  for (const list of Object.values(os.networkInterfaces())) {
    for (const a of list || []) {
      if (a.family !== 'IPv4' || a.internal) continue;
      if (a.address.startsWith('169.254.')) continue;
      out.add(a.address.split('.').slice(0, 3).join('.'));
    }
  }
  return [...out];
}

function portOpen(ip, timeout = 500) {
  return new Promise((resolve) => {
    const s = new net.Socket();
    let done = false;
    const end = (ok) => { if (done) return; done = true; s.destroy(); resolve(ok); };
    s.setTimeout(timeout);
    s.once('connect', () => end(true));
    s.once('timeout', () => end(false));
    s.once('error', () => end(false));
    s.connect(PORT, ip);
  });
}

function looksLikePrinter(ip, timeout = 4000) {
  return new Promise((resolve) => {
    let done = false;
    const ws = new WebSocket(`ws://${ip}:${PORT}`, { handshakeTimeout: timeout });
    const end = (info) => { if (done) return; done = true; try { ws.terminate(); } catch (_) {} resolve(info); };
    const t = setTimeout(() => end(null), timeout);
    ws.on('open', () => ws.send(JSON.stringify({ method: 'get', params: { ReqPrinterPara: 1 } })));
    ws.on('message', (d) => {
      try {
        const o = JSON.parse(d.toString());
        if (o && typeof o === 'object' && !o.ModeCode) {
          clearTimeout(t);
          end({ ip, model: o.model || o.modelVersion || o.hostname || 'Creality' });
        }
      } catch (_) {}
    });
    ws.on('error', () => { clearTimeout(t); end(null); });
  });
}

async function discover(onProgress) {
  const ips = [];
  for (const p of localPrefixes()) for (let i = 1; i < 255; i++) ips.push(`${p}.${i}`);
  const open = [];
  let idx = 0, checked = 0;
  async function worker() {
    while (idx < ips.length) {
      const ip = ips[idx++];
      if (await portOpen(ip)) open.push(ip);
      checked++;
      if (onProgress && checked % 16 === 0) onProgress(checked / ips.length);
    }
  }
  await Promise.all(Array.from({ length: 64 }, worker));
  const found = [];
  for (const ip of open) {
    const info = await looksLikePrinter(ip);
    if (info) found.push(info);
  }
  return found;
}

module.exports = { discover };
