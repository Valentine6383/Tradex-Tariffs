const $ = (id) => document.getElementById(id);
const api = window.k2;

let D = { connected: false, state: {}, cfg: { fans: [] }, objects: [], mode: 'compact' };
let lastIp = null;
const tick = {}; // значения таймеров + момент, когда их прислал принтер
const touched = {}; // когда пользователь последний раз трогал слайдер

const STATE_TXT = { 0: 'Простой', 1: 'Печать', 2: 'Готово ✓', 3: 'Ошибка', 4: 'Остановлено', 5: 'Пауза' };

const num = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? n : null; };
function fmtTime(sec) {
  if (sec == null || sec < 0) return '—';
  sec = Math.round(sec);
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
  return h ? `${h}ч ${String(m).padStart(2, '0')}м` : `${m}м ${String(s).padStart(2, '0')}с`;
}
function fileName(p) {
  if (!p) return '';
  return String(p).split(/[\\/]/).pop().replace(/\.(gcode|gco|g)$/i, '');
}
function temp(cur, target) {
  const c = num(cur), t = num(target);
  if (c == null) return '—';
  return t ? `${Math.round(c)}°/${Math.round(t)}°` : `${Math.round(c)}°`;
}
// ПЛА 1.75 мм: длина (мм) → граммы
const grams = (mm) => (mm * Math.PI * 0.875 * 0.875 * 1.24) / 1000;

function ticking(key, val, running) {
  const v = num(val);
  if (v == null) return null;
  if (!tick[key] || tick[key].v !== v) tick[key] = { v, at: Date.now() };
  return running ? (Date.now() - tick[key].at) / 1000 : 0;
}

function render() {
  const s = D.state || {};
  const st = Number(s.state);
  const printing = st === 1, paused = st === 5;
  const active = printing || paused;
  const pct = num(s.printProgress) ?? 0;

  document.body.classList.toggle('offline', !D.connected);
  $('card').classList.toggle('expanded', D.mode === 'expanded');
  $('btnExpand').textContent = D.mode === 'expanded' ? '▾' : '▴';

  // шапка
  const name = fileName(s.printFileName);
  if (!D.ip) { $('title').textContent = 'Укажи принтер в настройках'; }
  else if (!D.connected) { $('title').textContent = `Нет связи с ${D.ip}…`; }
  else { $('title').textContent = name || (STATE_TXT[st] || 'Принтер на связи'); }

  const runDelta = ticking('job', s.printJobTime, printing);
  const elapsed = num(s.printJobTime) != null ? num(s.printJobTime) + runDelta : null;
  const leftDelta = ticking('left', s.printLeftTime, printing);
  const left = num(s.printLeftTime) != null ? Math.max(0, num(s.printLeftTime) - leftDelta) : null;

  const layer = num(s.layer), total = num(s.TotalLayer ?? s.totalLayer);
  const parts = [];
  if (D.connected) {
    parts.push(STATE_TXT[st] || '—');
    if (active && left != null) {
      const eta = new Date(Date.now() + left * 1000);
      parts.push(`${fmtTime(left)} → ${eta.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })}`);
    }
    if (active && layer != null) parts.push(`сл. ${layer}${total ? '/' + total : ''}`);
  }
  $('sub').textContent = parts.join(' · ') || '—';
  $('pct').textContent = D.connected && (active || st === 2) ? `${Math.round(pct)}%` : '—';
  $('progFill').style.width = `${pct}%`;
  $('ringFg').style.strokeDashoffset = String(106.8 * (1 - pct / 100));

  for (const b of [$('btnPause'), $('btnPause2')]) b.disabled = !D.connected || !active;
  $('btnPause').textContent = paused ? '▶' : '❚❚';
  $('btnPause').classList.toggle('paused', paused);
  $('btnPause2').textContent = paused ? 'Продолжить' : 'Пауза';
  $('btnStop').disabled = !D.connected || !active;

  // статистика
  $('sNozzle').textContent = temp(s.nozzleTemp, s.targetNozzleTemp);
  $('sBed').textContent = temp(s.bedTemp0 ?? s.bedTemp, s.targetBedTemp0 ?? s.targetBedTemp);
  $('sBox').textContent = num(s.boxTemp) != null ? `${Math.round(num(s.boxTemp))}°` : '—';
  const sp = num(s.realTimeSpeed);
  $('sSpeed').textContent = sp != null ? `${Math.round(sp)} мм/с` : '—';
  const fl = num(s.realTimeFlow);
  $('sFlow').textContent = fl != null ? `${fl.toFixed(1)} мм³/с` : '—';
  $('sLayer').textContent = layer != null ? `${layer}${total ? ' / ' + total : ''}` : '—';
  $('sElapsed').textContent = fmtTime(elapsed);
  $('sLeft').textContent = fmtTime(left);
  const used = num(s.usedMaterialLength);
  if (used != null) {
    const g = grams(used);
    const est = pct > 3 ? g / (pct / 100) : null;
    $('sFil').textContent = est ? `${g.toFixed(0)} / ~${est.toFixed(0)} г` : `${g.toFixed(1)} г`;
    $('sFil').title = `${(used / 1000).toFixed(2)} м прутка`;
  } else $('sFil').textContent = '—';

  // скорость
  const feed = num(s.curFeedratePct);
  if (feed != null && !(Date.now() - (touched.speed || 0) < 5000)) {
    $('rSpeed').value = feed;
    $('vSpeed').textContent = `${Math.round(feed)}%`;
  }
  document.querySelectorAll('[data-speed]').forEach((b) => b.classList.toggle('on', Number(b.dataset.speed) === Math.round(Number($('rSpeed').value))));

  renderFans(s);
  renderObjects();

  // настройки
  if (D.ip !== lastIp) { $('ip').value = D.ip || ''; lastIp = D.ip; }
  $('cAuto').checked = !!D.cfg.autostart;
  $('cAlways').checked = !!D.cfg.alwaysShow;
  $('conn').textContent = D.connected ? `● Принтер на связи (${D.ip})` : (D.ip ? `○ Нет связи с ${D.ip}` : '○ Принтер не указан');

  // миниатюра
  const imgKey = D.connected ? `${D.ip}|${s.printFileName}` : '';
  if ($('thumbImg').dataset.key !== imgKey) {
    $('thumbImg').dataset.key = imgKey;
    if (imgKey) $('thumbImg').src = `http://${D.ip}/downloads/original/current_print_image.png?t=${Date.now()}`;
    else $('thumbImg').style.display = 'none';
  }
}

function renderFans(s) {
  const box = $('fans');
  if (box.childElementCount !== D.cfg.fans.length) {
    box.innerHTML = '';
    D.cfg.fans.forEach((f, i) => {
      const el = document.createElement('div');
      el.className = 'ctl';
      el.innerHTML = `<div class="ctlhead"><span></span><b>—</b></div><input type="range" min="0" max="100" step="5" value="0">`;
      el.querySelector('span').textContent = '🌀 ' + f.name;
      const r = el.querySelector('input'), v = el.querySelector('b');
      r.addEventListener('input', () => { touched['fan' + i] = Date.now(); v.textContent = `${r.value}%`; });
      r.addEventListener('change', () => { touched['fan' + i] = Date.now(); api.cmd({ type: 'fan', index: f.index, value: Number(r.value) }); });
      box.appendChild(el);
    });
  }
  D.cfg.fans.forEach((f, i) => {
    const el = box.children[i];
    const val = num(s[f.key]);
    const r = el.querySelector('input'), v = el.querySelector('b');
    r.disabled = !D.connected;
    if (val != null && !(Date.now() - (touched['fan' + i] || 0) < 5000)) { r.value = val; v.textContent = `${Math.round(val)}%`; }
  });
}

let objSig = '';
function renderObjects() {
  const sig = JSON.stringify(D.objects) + D.connected;
  if (sig === objSig) return;
  objSig = sig;
  const list = $('objList');
  list.innerHTML = '';
  $('objEmpty').classList.toggle('hidden', D.objects.length > 0);
  D.objects.forEach((o) => {
    const el = document.createElement('div');
    el.className = 'obj' + (o.excluded ? ' ex' : '');
    const n = document.createElement('span'); n.textContent = o.name; n.title = o.name;
    const b = document.createElement('button');
    b.textContent = o.excluded ? 'Пропущена' : 'Не печатать';
    b.className = o.excluded ? '' : 'danger';
    b.disabled = o.excluded || !D.connected;
    b.onclick = () => ask(`Пропустить «${o.name}»? Вернуть её в эту печать уже не получится.`, () => api.cmd({ type: 'exclude', name: o.name }));
    el.append(n, b);
    list.appendChild(el);
  });
}

function ask(text, yes) {
  $('confirmText').textContent = text;
  $('confirm').classList.remove('hidden');
  $('cYes').onclick = () => { $('confirm').classList.add('hidden'); yes(); };
  $('cNo').onclick = () => $('confirm').classList.add('hidden');
}

function setMode(m) { D.mode = m; render(); api.cmd({ type: 'mode', value: m }); }
function openTab(t) {
  document.querySelectorAll('.tab').forEach((b) => b.classList.toggle('on', b.dataset.tab === t));
  ['main', 'objects', 'settings'].forEach((x) => $('tab-' + x).classList.toggle('hidden', x !== t));
}

// ---- события ----
$('btnExpand').onclick = () => setMode(D.mode === 'expanded' ? 'compact' : 'expanded');
$('btnHide').onclick = () => api.cmd({ type: 'hide' });
const togglePause = () => api.cmd({ type: Number(D.state.state) === 5 ? 'resume' : 'pause' });
$('btnPause').onclick = togglePause;
$('btnPause2').onclick = togglePause;
$('btnStop').onclick = () => ask('Остановить печать совсем? Это не пауза.', () => api.cmd({ type: 'stop' }));
document.querySelectorAll('.tab').forEach((b) => (b.onclick = () => openTab(b.dataset.tab)));

$('rSpeed').addEventListener('input', () => { touched.speed = Date.now(); $('vSpeed').textContent = `${$('rSpeed').value}%`; render(); });
$('rSpeed').addEventListener('change', () => { touched.speed = Date.now(); api.cmd({ type: 'speed', value: Number($('rSpeed').value) }); });
document.querySelectorAll('[data-speed]').forEach((b) => (b.onclick = () => {
  touched.speed = Date.now();
  $('rSpeed').value = b.dataset.speed; $('vSpeed').textContent = `${b.dataset.speed}%`;
  api.cmd({ type: 'speed', value: Number(b.dataset.speed) }); render();
}));

$('btnSaveIp').onclick = () => api.cmd({ type: 'setIp', value: $('ip').value });
$('ip').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('btnSaveIp').click(); });
$('cAuto').onchange = () => api.cmd({ type: 'setCfg', value: { autostart: $('cAuto').checked } });
$('cAlways').onchange = () => api.cmd({ type: 'setCfg', value: { alwaysShow: $('cAlways').checked } });
$('btnScan').onclick = async () => {
  $('btnScan').disabled = true; $('scanRes').textContent = 'Ищу… (секунд 10–20)';
  try {
    const found = await api.cmd({ type: 'discover' });
    if (!found.length) $('scanRes').textContent = 'Ничего не нашёл. Проверь, что комп и принтер в одной Wi-Fi сети, или впиши IP руками.';
    else {
      $('scanRes').textContent = `Нашёл: ${found.map((f) => f.ip).join(', ')} — подключаюсь к ${found[0].ip}`;
      $('ip').value = found[0].ip;
      api.cmd({ type: 'setIp', value: found[0].ip });
    }
  } finally { $('btnScan').disabled = false; }
};
api.onScanProgress((p) => { $('scanRes').textContent = `Ищу… ${Math.round(p * 100)}%`; });

$('btnGcode').onclick = async () => {
  const n = await api.cmd({ type: 'loadGcode' });
  if (n === 0) alertHint('В файле нет меток деталей. В Creality Print включи «Label objects» / «Пометить объекты» и перенарежь.');
};
function alertHint(t) { $('objEmpty').textContent = t; $('objEmpty').classList.remove('hidden'); }
document.addEventListener('dragover', (e) => e.preventDefault());
document.addEventListener('drop', async (e) => {
  e.preventDefault();
  const f = e.dataTransfer.files[0];
  if (!f) return;
  const n = await api.cmd({ type: 'gcodeText', value: await f.text() });
  setMode('expanded'); openTab('objects');
  if (!n) alertHint('В файле нет меток деталей. В Creality Print включи «Label objects» / «Пометить объекты» и перенарежь.');
});

$('thumbImg').onload = () => ($('thumbImg').style.display = 'block');
$('thumbImg').onerror = () => ($('thumbImg').style.display = 'none');

api.onOpenSettings(() => { setMode('expanded'); openTab('settings'); });
api.onUpdate((d) => {
  const wasNoIp = !D.ip;
  D = d;
  if (!d.ip && wasNoIp && d.mode !== 'expanded' && !render.once) { render.once = true; setMode('expanded'); openTab('settings'); return; }
  render();
});
render();
