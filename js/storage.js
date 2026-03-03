// ============================================================
//  storage.js  —  KanjiBaby storage manager v2
//
//  Architettura ibrida:
//  • localStorage  →  cache locale veloce (letture istantanee)
//  • Apps Script   →  persistenza cloud cross-device
//
//  Flusso:
//  1. Pagina aperta  → carica dal cloud, popola localStorage
//  2. Ogni risposta  → aggiorna localStorage subito (UI reattiva)
//                    → accoda update al cloud (batch asincrono)
//  3. Ogni 30s       → flush batch pendente al cloud
//  4. Prima di uscire dalla pagina → flush immediato
// ============================================================

// 🔧 INCOLLA QUI L'URL della tua App Script dopo il deploy
const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbx6BZiVYLag8wg8jQKAQkxwHcJ2Ifvozr0kFPPp1He70-PikEo5Vt-NLc0kcQhsflw/exec";

const STORAGE_PREFIX = "kanjibaby_";
const KEY_SRS        = STORAGE_PREFIX + "srs";
const KEY_WRITE      = STORAGE_PREFIX + "write";
const KEY_MNEMO      = STORAGE_PREFIX + "mnemo";
const KEY_JOYO       = STORAGE_PREFIX + "joyo";
const KEY_SYNCED     = STORAGE_PREFIX + "lastSync";

// ── Batch di aggiornamenti in attesa di essere inviati ──────
let _pendingUpdates = {};   // { kanji: { srs?, write?, mnemonic? } }
let _flushTimer     = null;
let _syncReady      = false;

// ============================================================
//  INIT SYNC  —  chiama dopo loadDB(): initSync()
//  Carica tutti i dati dal cloud e sovrascrive localStorage
// ============================================================
async function initSync() {
  if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.startsWith("INSERISCI")) {
    console.warn("[storage] Apps Script URL non configurato — solo localStorage");
    _syncReady = true;
    return;
  }

  try {
    const res  = await fetch(`${APPS_SCRIPT_URL}?action=getAll`);
    const json = await res.json();

    if (!json.ok) throw new Error(json.error);

    const data    = json.data || {};
    const srsDB   = {};
    const writeDB = {};
    const mnemo   = {};

    for (const [kanji, rec] of Object.entries(data)) {
      if (rec.srs      && Object.keys(rec.srs).length)   srsDB[kanji]   = rec.srs;
      if (rec.write    && Object.keys(rec.write).length)  writeDB[kanji] = rec.write;
      if (rec.mnemonic) mnemo[kanji] = rec.mnemonic;
    }

    _save(KEY_SRS,   srsDB);
    _save(KEY_WRITE, writeDB);
    _save(KEY_MNEMO, mnemo);
    localStorage.setItem(KEY_SYNCED, new Date().toISOString());
    console.log(`[storage] Sync completato — ${Object.keys(data).length} kanji`);
  } catch (err) {
    console.warn("[storage] Sync fallito, uso cache locale:", err.message);
  }

  _syncReady = true;
  _startFlushTimer();
}

// ============================================================
//  FLUSH  —  invia batch al cloud
// ============================================================
async function flushToCloud() {
  if (!_syncReady) return;
  if (!APPS_SCRIPT_URL || APPS_SCRIPT_URL.startsWith("INSERISCI")) return;
  if (Object.keys(_pendingUpdates).length === 0) return;

  const updates = Object.entries(_pendingUpdates).map(([kanji, d]) => ({ kanji, ...d }));
  _pendingUpdates = {};

  try {
    const res  = await fetch(APPS_SCRIPT_URL, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ action: "save", updates }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    console.log(`[storage] Salvati ${json.saved} kanji sul cloud`);
  } catch (err) {
    console.warn("[storage] Flush fallito, rimetto in coda:", err.message);
    for (const u of updates) {
      _pendingUpdates[u.kanji] = _pendingUpdates[u.kanji] || {};
      Object.assign(_pendingUpdates[u.kanji], u);
    }
  }
}

function _startFlushTimer() {
  _flushTimer = setInterval(flushToCloud, 30_000);
}

window.addEventListener("beforeunload", () => {
  if (Object.keys(_pendingUpdates).length === 0) return;
  if (navigator.sendBeacon && !APPS_SCRIPT_URL.startsWith("INSERISCI")) {
    const updates = Object.entries(_pendingUpdates).map(([kanji, d]) => ({ kanji, ...d }));
    navigator.sendBeacon(APPS_SCRIPT_URL, JSON.stringify({ action: "save", updates }));
  }
});

function _queueUpdate(kanji, data) {
  _pendingUpdates[kanji] = _pendingUpdates[kanji] || {};
  Object.assign(_pendingUpdates[kanji], data);
}

// ============================================================
//  UTILS localStorage
// ============================================================
function _load(key) {
  try { return JSON.parse(localStorage.getItem(key)) || {}; }
  catch { return {}; }
}
function _save(key, data) {
  try { localStorage.setItem(key, JSON.stringify(data)); }
  catch (e) { console.warn("[storage] Errore salvataggio:", e); }
}

// ============================================================
//  JOYO FILTER
// ============================================================
function getJoyoFilter() { return localStorage.getItem(KEY_JOYO) !== "0"; }
function setJoyoFilter(enabled) { localStorage.setItem(KEY_JOYO, enabled ? "1" : "0"); }

// ============================================================
//  SRS  (SM-2)
// ============================================================
const SRS_DEFAULT = {
  interval: 0, easiness: 2.5, repetitions: 0,
  dueDate: new Date(0).toISOString(),
  totalSeen: 0, totalCorrect: 0,
};

function getSRSRecord(kanji) {
  return Object.assign({}, SRS_DEFAULT, (_load(KEY_SRS))[kanji] || {});
}

function updateSRS(kanji, correct) {
  const db  = _load(KEY_SRS);
  const rec = Object.assign({}, SRS_DEFAULT, db[kanji] || {});

  rec.totalSeen++;
  if (correct) rec.totalCorrect++;

  const q      = correct ? 4 : 1;
  rec.easiness = Math.max(1.3, rec.easiness + 0.1 - (5-q)*(0.08+(5-q)*0.02));

  if (!correct) { rec.interval = 0; rec.repetitions = 0; }
  else {
    if      (rec.repetitions === 0) rec.interval = 1;
    else if (rec.repetitions === 1) rec.interval = 6;
    else rec.interval = Math.round(rec.interval * rec.easiness);
    rec.repetitions++;
  }

  const due = new Date();
  due.setDate(due.getDate() + rec.interval);
  rec.dueDate = due.toISOString();

  db[kanji] = rec;
  _save(KEY_SRS, db);
  _queueUpdate(kanji, { srs: rec });
  return rec;
}

function getDueKanji(kanjiList) {
  const db  = _load(KEY_SRS);
  const now = new Date();
  return kanjiList
    .map(k => ({ ...k, srs: Object.assign({}, SRS_DEFAULT, db[k.kanji] || {}) }))
    .filter(k => new Date(k.srs.dueDate) <= now)
    .sort((a, b) => {
      const aN = a.srs.totalSeen === 0, bN = b.srs.totalSeen === 0;
      if (aN && !bN) return -1; if (!aN && bN) return 1;
      const dd = new Date(a.srs.dueDate) - new Date(b.srs.dueDate);
      if (dd !== 0) return dd;
      const aE = a.srs.totalSeen ? 1 - a.srs.totalCorrect/a.srs.totalSeen : 1;
      const bE = b.srs.totalSeen ? 1 - b.srs.totalCorrect/b.srs.totalSeen : 1;
      return bE - aE;
    });
}

// ============================================================
//  SCRITTURA  —  ordine RANDOM (indipendente da SRS)
// ============================================================
function getWriteRecord(kanji) {
  return (_load(KEY_WRITE))[kanji] || { totalSeen: 0, totalCorrect: 0 };
}

function updateWrite(kanji, correct) {
  const db  = _load(KEY_WRITE);
  const rec = db[kanji] || { totalSeen: 0, totalCorrect: 0 };
  rec.totalSeen++;
  if (correct) rec.totalCorrect++;
  db[kanji] = rec;
  _save(KEY_WRITE, db);
  _queueUpdate(kanji, { write: rec });
  return rec;
}

// Shuffle Fisher-Yates
function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getWriteQueue(kanjiList) {
  return shuffleArray(kanjiList);
}

// ============================================================
//  MNEMONICI
// ============================================================
function getMnemonic(kanji) { return (_load(KEY_MNEMO))[kanji] || ""; }

function setMnemonic(kanji, text) {
  const db = _load(KEY_MNEMO);
  if (text.trim()) db[kanji] = text.trim();
  else delete db[kanji];
  _save(KEY_MNEMO, db);
  _queueUpdate(kanji, { mnemonic: text.trim() });
  flushToCloud(); // flush immediato per azione esplicita
}

// ============================================================
//  STATISTICHE GLOBALI
// ============================================================
function getAllStats() {
  const srsDB   = _load(KEY_SRS);
  const writeDB = _load(KEY_WRITE);
  const result  = {};
  const all     = new Set([...Object.keys(srsDB), ...Object.keys(writeDB)]);

  for (const k of all) {
    const s = Object.assign({}, SRS_DEFAULT, srsDB[k] || {});
    const w = writeDB[k] || { totalSeen: 0, totalCorrect: 0 };
    const srsAcc   = s.totalSeen ? s.totalCorrect / s.totalSeen  : null;
    const writeAcc = w.totalSeen ? w.totalCorrect / w.totalSeen  : null;
    const combined = [srsAcc, writeAcc].filter(v => v !== null);
    const avg      = combined.length ? combined.reduce((a,b)=>a+b,0)/combined.length : null;
    let level = 0;
    if      (avg === null) level = 0;
    else if (avg < 0.5)    level = 1;
    else if (avg < 0.75)   level = 2;
    else if (avg < 0.9)    level = 3;
    else                   level = 4;
    result[k] = { srsAcc, writeAcc, avg, level, srsSeen: s.totalSeen, writeSeen: w.totalSeen };
  }
  return result;
}

// ============================================================
//  RESET
// ============================================================
function resetAllData() {
  if (confirm("Cancellare tutti i dati locali?\nI dati sul Google Sheet rimangono intatti.")) {
    [KEY_SRS, KEY_WRITE, KEY_MNEMO].forEach(k => localStorage.removeItem(k));
    _pendingUpdates = {};
    alert("Cache locale cancellata.");
  }
}

// ============================================================
//  STATUS SYNC
// ============================================================
function getSyncStatus() {
  const last = localStorage.getItem(KEY_SYNCED);
  return {
    lastSync:        last ? new Date(last).toLocaleString('it-IT') : 'mai',
    pending:         Object.keys(_pendingUpdates).length,
    cloudConfigured: !APPS_SCRIPT_URL.startsWith("INSERISCI"),
  };
}
