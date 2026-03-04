// ============================================================
//  storage.js  —  KanjiBaby storage manager v4
// ============================================================

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzI3xt-ql53uJvJB7biBFYIFGJ3CP5-tqIl2x5EIXmMXTpX38jOAQzyPc5fDrkLacPYZQ/exec";

const P = "kanjibaby_";
const KEY_SRS          = P + "srs";
const KEY_WRITE        = P + "write";
const KEY_MNEMO        = P + "mnemo";
const KEY_JOYO         = P + "joyo";
const KEY_FONT         = P + "font";
const KEY_DARK         = P + "dark";
const KEY_FC_PRIORITY  = P + "fcpriority";   // "srs" | "new"
const KEY_RECORD_HS    = P + "record_hs";    // highscore mode record
const KEY_RECORD_QNS   = P + "record_qns";   // quante-ne-sai record
const KEY_EVER_SYNCED  = P + "everSynced";

let _pending    = {};
let _flushTimer = null;

// ============================================================
//  SETTINGS  (font, dark mode, flashcard priority)
// ============================================================
function getFont()         { return localStorage.getItem(KEY_FONT)  || 'shippori'; }
function setFont(f)        { localStorage.setItem(KEY_FONT, f);  applyFont(f); }
function getDarkMode()     { return localStorage.getItem(KEY_DARK)  !== '0'; }
function setDarkMode(v)    { localStorage.setItem(KEY_DARK, v ? '1' : '0'); applyDark(v); }
function getFCPriority()   { return localStorage.getItem(KEY_FC_PRIORITY) || 'srs'; }
function setFCPriority(v)  { localStorage.setItem(KEY_FC_PRIORITY, v); }

function applyFont(f) {
  document.documentElement.setAttribute('data-font', f || getFont());
}
function applyDark(v) {
  const dark = (v !== undefined) ? v : getDarkMode();
  document.documentElement.setAttribute('data-theme', dark ? 'dark' : 'light');
}
function applySettings() {
  applyFont();
  applyDark();
}

// ── Chiama questo nel <head> di ogni pagina (inline) ─────────
// (function(){ applySettings(); })()  ← dopo aver caricato storage.js

// ============================================================
//  RECORDS (parole)
// ============================================================
function getRecord(key)       { return parseInt(localStorage.getItem(key) || '0', 10); }
function setRecord(key, val)  {
  localStorage.setItem(key, val);
  _pending['__record_' + key] = { record_key: key, record_val: val };
  clearTimeout(_flushTimer);
  flushToCloud();
}
function getHSRecord()        { return getRecord(KEY_RECORD_HS); }
function setHSRecord(v)       { if (v > getHSRecord()) setRecord(KEY_RECORD_HS, v); }
function getQNSRecord()       { return getRecord(KEY_RECORD_QNS); }
function setQNSRecord(v)      { if (v > getQNSRecord()) setRecord(KEY_RECORD_QNS, v); }

// ============================================================
//  INIT SYNC
// ============================================================
function initSync() {
  applySettings();
  const hasLocal = localStorage.getItem(KEY_SRS) || localStorage.getItem(KEY_WRITE) || localStorage.getItem(KEY_MNEMO);
  if (!hasLocal && !localStorage.getItem(KEY_EVER_SYNCED)) {
    _pullFromCloud().then(() => localStorage.setItem(KEY_EVER_SYNCED, '1'));
  }
}

async function _pullFromCloud() {
  try {
    const res  = await fetch(APPS_SCRIPT_URL + '?action=getAll');
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    const { data = {} } = json;
    const srsDB = {}, writeDB = {}, mnemo = {};
    for (const [k, rec] of Object.entries(data)) {
      if (rec.srs      && Object.keys(rec.srs).length)   srsDB[k]   = rec.srs;
      if (rec.write    && Object.keys(rec.write).length)  writeDB[k] = rec.write;
      if (rec.mnemonic) mnemo[k] = rec.mnemonic;
    }
    if (Object.keys(srsDB).length)   _save(KEY_SRS,   srsDB);
    if (Object.keys(writeDB).length) _save(KEY_WRITE, writeDB);
    if (Object.keys(mnemo).length)   _save(KEY_MNEMO, mnemo);
    // Records
    if (data['__hs_record'])  localStorage.setItem(KEY_RECORD_HS,  data['__hs_record'].val || 0);
    if (data['__qns_record']) localStorage.setItem(KEY_RECORD_QNS, data['__qns_record'].val || 0);
    console.log('[storage] Download cloud OK —', Object.keys(data).length, 'voci');
  } catch (e) { console.warn('[storage] Download cloud fallito:', e.message); }
}

// ============================================================
//  FORCE SYNC  (pulsanti settings)
// ============================================================
async function forceDownload() {
  try {
    const res  = await fetch(APPS_SCRIPT_URL + '?action=getAll');
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    const { data = {} } = json;
    const srsDB = {}, writeDB = {}, mnemo = {};
    for (const [k, rec] of Object.entries(data)) {
      if (rec.srs      && Object.keys(rec.srs).length)   srsDB[k]   = rec.srs;
      if (rec.write    && Object.keys(rec.write).length)  writeDB[k] = rec.write;
      if (rec.mnemonic) mnemo[k] = rec.mnemonic;
    }
    _save(KEY_SRS,   srsDB);
    _save(KEY_WRITE, writeDB);
    _save(KEY_MNEMO, mnemo);
    if (data['__hs_record'])  localStorage.setItem(KEY_RECORD_HS,  data['__hs_record'].val  || 0);
    if (data['__qns_record']) localStorage.setItem(KEY_RECORD_QNS, data['__qns_record'].val || 0);
    localStorage.setItem(KEY_EVER_SYNCED, '1');
    return { ok: true, count: Object.keys(data).length };
  } catch (e) { return { ok: false, error: e.message }; }
}

async function forceUpload() {
  const srsDB   = _load(KEY_SRS);
  const writeDB = _load(KEY_WRITE);
  const mnemo   = _load(KEY_MNEMO);
  const all     = new Set([...Object.keys(srsDB), ...Object.keys(writeDB), ...Object.keys(mnemo)]);
  const updates = [];
  for (const k of all) {
    const u = { kanji: k };
    if (srsDB[k])   u.srs      = srsDB[k];
    if (writeDB[k]) u.write    = writeDB[k];
    if (mnemo[k])   u.mnemonic = mnemo[k];
    updates.push(u);
  }
  // Records
  const hs  = getHSRecord();
  const qns = getQNSRecord();
  if (hs)  updates.push({ kanji: '__hs_record',  record_key: KEY_RECORD_HS,  record_val: hs });
  if (qns) updates.push({ kanji: '__qns_record', record_key: KEY_RECORD_QNS, record_val: qns });

  try {
    const res  = await fetch(APPS_SCRIPT_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'save', updates }),
    });
    const json = await res.json();
    return json;
  } catch (e) { return { ok: false, error: e.message }; }
}

// ============================================================
//  FLUSH
// ============================================================
async function flushToCloud() {
  if (Object.keys(_pending).length === 0) return;
  const updates = Object.entries(_pending).map(([kanji, d]) => ({ kanji, ...d }));
  _pending = {};
  try {
    const res  = await fetch(APPS_SCRIPT_URL, {
      method: 'POST', headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify({ action: 'save', updates }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
  } catch (e) {
    console.warn('[storage] Flush fallito:', e.message);
    for (const u of updates) { _pending[u.kanji] = _pending[u.kanji] || {}; Object.assign(_pending[u.kanji], u); }
  }
}

function _scheduleFlush() { clearTimeout(_flushTimer); _flushTimer = setTimeout(flushToCloud, 3000); }
function _queueUpdate(k, d) { _pending[k] = _pending[k] || {}; Object.assign(_pending[k], d); _scheduleFlush(); }

window.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') { clearTimeout(_flushTimer); flushToCloud(); }
});

// ============================================================
//  localStorage utils
// ============================================================
function _load(key)     { try { return JSON.parse(localStorage.getItem(key)) || {}; } catch { return {}; } }
function _save(key, d)  { try { localStorage.setItem(key, JSON.stringify(d)); } catch(e) { console.warn(e); } }

// ============================================================
//  JOYO
// ============================================================
function getJoyoFilter()  { return localStorage.getItem(KEY_JOYO) !== '0'; }
function setJoyoFilter(v) { localStorage.setItem(KEY_JOYO, v ? '1' : '0'); }

// ============================================================
//  SRS  (SM-2)
// ============================================================
const SRS_DEFAULT = { interval:0, easiness:2.5, repetitions:0,
  dueDate: new Date(0).toISOString(), totalSeen:0, totalCorrect:0 };

function getSRSRecord(kanji) { return Object.assign({}, SRS_DEFAULT, (_load(KEY_SRS))[kanji] || {}); }

function updateSRS(kanji, correct) {
  const db  = _load(KEY_SRS);
  const rec = Object.assign({}, SRS_DEFAULT, db[kanji] || {});
  rec.totalSeen++; if (correct) rec.totalCorrect++;
  const q = correct ? 4 : 1;
  rec.easiness = Math.max(1.3, rec.easiness + 0.1 - (5-q)*(0.08+(5-q)*0.02));
  if (!correct) { rec.interval = 0; rec.repetitions = 0; }
  else {
    if      (rec.repetitions === 0) rec.interval = 1;
    else if (rec.repetitions === 1) rec.interval = 6;
    else rec.interval = Math.round(rec.interval * rec.easiness);
    rec.repetitions++;
  }
  const due = new Date(); due.setDate(due.getDate() + rec.interval);
  rec.dueDate = due.toISOString();
  db[kanji] = rec; _save(KEY_SRS, db);
  _queueUpdate(kanji, { srs: rec });
  return rec;
}

function getDueKanji(kanjiList) {
  const db  = _load(KEY_SRS);
  const now = new Date();
  const priority = getFCPriority();

  const withSRS = kanjiList.map(k => ({ ...k, srs: Object.assign({}, SRS_DEFAULT, db[k.kanji] || {}) }));

  if (priority === 'new') {
    // Nuovi prima, poi SRS scaduti
    const unseen = withSRS.filter(k => k.srs.totalSeen === 0);
    const due    = withSRS.filter(k => k.srs.totalSeen > 0 && new Date(k.srs.dueDate) <= now)
      .sort((a,b) => new Date(a.srs.dueDate) - new Date(b.srs.dueDate));
    return [...unseen, ...due];
  }

  // default: SRS puro
  return withSRS
    .filter(k => new Date(k.srs.dueDate) <= now)
    .sort((a, b) => {
      const aN = a.srs.totalSeen===0, bN = b.srs.totalSeen===0;
      if (aN && !bN) return -1; if (!aN && bN) return 1;
      const dd = new Date(a.srs.dueDate) - new Date(b.srs.dueDate);
      if (dd !== 0) return dd;
      const aE = a.srs.totalSeen ? 1-a.srs.totalCorrect/a.srs.totalSeen : 1;
      const bE = b.srs.totalSeen ? 1-b.srs.totalCorrect/b.srs.totalSeen : 1;
      return bE - aE;
    });
}

// ============================================================
//  SCRITTURA  —  random
// ============================================================
function getWriteRecord(kanji) { return (_load(KEY_WRITE))[kanji] || { totalSeen:0, totalCorrect:0 }; }

function updateWrite(kanji, correct) {
  const db = _load(KEY_WRITE);
  const rec = db[kanji] || { totalSeen:0, totalCorrect:0 };
  rec.totalSeen++; if (correct) rec.totalCorrect++;
  db[kanji] = rec; _save(KEY_WRITE, db);
  _queueUpdate(kanji, { write: rec });
  return rec;
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length-1; i > 0; i--) { const j = Math.floor(Math.random()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}
function getWriteQueue(kanjiList) { return shuffleArray(kanjiList); }

// ============================================================
//  MNEMONICI
// ============================================================
function getMnemonic(kanji) { return (_load(KEY_MNEMO))[kanji] || ''; }
function setMnemonic(kanji, text) {
  const db = _load(KEY_MNEMO);
  if (text.trim()) db[kanji] = text.trim(); else delete db[kanji];
  _save(KEY_MNEMO, db);
  _pending[kanji] = _pending[kanji] || {};
  Object.assign(_pending[kanji], { mnemonic: text.trim() });
  clearTimeout(_flushTimer); flushToCloud();
}

// ============================================================
//  STATISTICHE GLOBALI
// ============================================================
function getAllStats() {
  const srsDB = _load(KEY_SRS), writeDB = _load(KEY_WRITE);
  const res = {}, all = new Set([...Object.keys(srsDB), ...Object.keys(writeDB)]);
  for (const k of all) {
    const s = Object.assign({}, SRS_DEFAULT, srsDB[k]||{});
    const w = writeDB[k] || { totalSeen:0, totalCorrect:0 };
    const sA = s.totalSeen ? s.totalCorrect/s.totalSeen : null;
    const wA = w.totalSeen ? w.totalCorrect/w.totalSeen : null;
    const cb = [sA,wA].filter(v=>v!==null);
    const avg = cb.length ? cb.reduce((a,b)=>a+b,0)/cb.length : null;
    let level = avg===null?0 : avg<0.5?1 : avg<0.75?2 : avg<0.9?3 : 4;
    res[k] = { srsAcc:sA, writeAcc:wA, avg, level, srsSeen:s.totalSeen, writeSeen:w.totalSeen };
  }
  return res;
}

// ============================================================
//  RESET
// ============================================================
function resetAllData() {
  if (confirm('Cancellare tutti i dati locali?\nI dati sul cloud rimangono.')) {
    [KEY_SRS,KEY_WRITE,KEY_MNEMO,KEY_EVER_SYNCED].forEach(k=>localStorage.removeItem(k));
    _pending = {}; alert('Cache locale cancellata. Ricarica la pagina.');
  }
}
