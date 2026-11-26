// Имитация принтера K2 на ws://127.0.0.1:9999 — для проверки виджета без железа
const { WebSocketServer } = require('ws');
const wss = new WebSocketServer({ port: 9999, host: '127.0.0.1' });
const st = { state: 1, printProgress: 42, printFileName: '/mnt/UDISK/printer_data/gcodes/Кронштейн_x4_PLA_2h13m.gcode',
  nozzleTemp: '219.80', targetNozzleTemp: 220, bedTemp0: '59.90', targetBedTemp0: 60, boxTemp: 34,
  printJobTime: 3360, printLeftTime: 4630, layer: 87, TotalLayer: 210, curFeedratePct: 100,
  realTimeSpeed: '187.4', realTimeFlow: '14.2', usedMaterialLength: 18450,
  modelFanPct: 100, auxiliaryFanPct: 40, caseFanPct: 0 };
const log = [];
wss.on('connection', (ws) => {
  ws.send(JSON.stringify(st));
  const t = setInterval(() => { st.printJobTime += 2; st.printLeftTime -= 2; ws.send(JSON.stringify({ printJobTime: st.printJobTime, printLeftTime: st.printLeftTime, nozzleTemp: (219.5 + Math.random()).toFixed(2) })); }, 2000);
  ws.on('message', (m) => {
    const o = JSON.parse(m); log.push(o); console.log('RX', JSON.stringify(o));
    const p = (o.params || {});
    if (p.pause === 1) st.state = 5; if (p.pause === 0) st.state = 1; if (p.stop === 1) st.state = 4;
    if (p.setFeedratePct) st.curFeedratePct = p.setFeedratePct;
    const g = /M106 P(\d) S(\d+)/.exec(p.gcodeCmd || '');
    if (g) st[{ 0: 'modelFanPct', 2: 'auxiliaryFanPct', 1: 'caseFanPct' }[g[1]]] = Math.round(g[2] / 2.55);
    ws.send(JSON.stringify(st));
  });
  ws.on('close', () => clearInterval(t));
});
console.log('mock printer up');
