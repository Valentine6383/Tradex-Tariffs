// Подключение к принтеру Creality серии K (K1/K2) по локальному WebSocket (порт 9999).
// Это тот же канал, через который с принтером общается Creality Print.
// Принтер шлёт JSON с частичными обновлениями, мы склеиваем их в одно состояние.
const { EventEmitter } = require('events');
const WebSocket = require('ws');

const PORT = 9999;

class Printer extends EventEmitter {
  constructor() {
    super();
    this.ip = null;
    this.ws = null;
    this.state = {};
    this.connected = false;
    this.lastMsg = 0;
    this.timers = [];
    this.rawLog = [];
    this.closedByUs = false;
  }

  connect(ip) {
    this.disconnect();
    this.ip = ip;
    this.state = {};
    this.closedByUs = false;
    this._open();
    this.timers.push(setInterval(() => this._watchdog(), 5000));
    this.timers.push(setInterval(() => this._heartbeat(), 10000));
  }

  disconnect() {
    this.closedByUs = true;
    this.timers.forEach(clearInterval);
    this.timers = [];
    if (this.ws) {
      try { this.ws.terminate(); } catch (_) {}
      this.ws = null;
    }
    this._setConnected(false);
  }

  _open() {
    if (!this.ip) return;
    const ws = new WebSocket(`ws://${this.ip}:${PORT}`, { handshakeTimeout: 4000 });
    this.ws = ws;
    ws.on('open', () => {
      this.lastMsg = Date.now();
      this._setConnected(true);
      // Просим полную сводку параметров (принтер может проигнорировать — не страшно)
      this.send({ method: 'get', params: { ReqPrinterPara: 1 } });
    });
    ws.on('message', (data) => this._onMessage(data.toString()));
    ws.on('error', () => {});
    ws.on('close', () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this._setConnected(false);
      if (!this.closedByUs) setTimeout(() => { if (!this.ws && !this.closedByUs) this._open(); }, 3000);
    });
  }

  _watchdog() {
    if (!this.ws && !this.closedByUs) { this._open(); return; }
    // Если принтер молчит 30 секунд — переподключаемся
    if (this.connected && Date.now() - this.lastMsg > 30000) {
      try { this.ws.terminate(); } catch (_) {}
    }
  }

  _heartbeat() {
    this.send({ ModeCode: 'heart_beat', msg: new Date().toISOString() });
  }

  _setConnected(v) {
    if (this.connected === v) return;
    this.connected = v;
    this.emit('connection', v);
  }

  _onMessage(text) {
    this.lastMsg = Date.now();
    this.rawLog.push({ t: new Date().toISOString(), m: text.slice(0, 4000) });
    if (this.rawLog.length > 300) this.rawLog.shift();
    let obj;
    try { obj = JSON.parse(text); } catch (_) { return; }
    if (!obj || typeof obj !== 'object') return;
    if (obj.ModeCode === 'heart_beat') {
      this.send({ ModeCode: 'heart_beat', msg: 'ok' });
      return;
    }
    Object.assign(this.state, obj);
    this.emit('state', this.state);
  }

  send(obj) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return false;
    this.ws.send(JSON.stringify(obj));
    return true;
  }

  set(params) { return this.send({ method: 'set', params }); }
  gcode(cmd) { return this.set({ gcodeCmd: cmd }); }

  pause() { return this.set({ pause: 1 }); }
  resume() { return this.set({ pause: 0 }); }
  stop() { return this.set({ stop: 1 }); }
  speed(pct) {
    pct = Math.max(10, Math.min(300, Math.round(pct)));
    // Штатная команда Creality + дублируем стандартным G-code на всякий случай
    this.set({ setFeedratePct: pct });
    return this.gcode(`M220 S${pct}`);
  }
  fan(index, pct) {
    const s = Math.round(Math.max(0, Math.min(100, pct)) * 2.55);
    return this.gcode(`M106 P${index} S${s}`);
  }
  excludeObject(name) {
    return this.gcode(`EXCLUDE_OBJECT NAME=${name}`);
  }
}

module.exports = { Printer, PORT };
