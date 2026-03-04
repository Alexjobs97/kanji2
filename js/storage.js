// ============================================================
//  storage.js  —  KanjiBaby storage manager v3
//
//  Architettura corretta:
//  • localStorage  →  fonte di verità primaria (sempre usata)
//  • Apps Script   →  backup cloud, NON sovrascrive localStorage
//                     a meno che sia il primo accesso assoluto
//
//  Flusso:
//  1. Pagina aperta → UI usa subito localStorage (nessuna attesa)
//  2. Se localStorage è vuoto → scarica dal cloud (primo accesso)
//  3. Ogni risposta → salva in localStorage + debounce 3s → flush cloud
//  4. Salvataggio mnemonico → flush immediato
// ============================================================

const APPS_SCRIPT_URL = "https://script.google.com/macros/s/AKfycbzI3xt-ql53uJvJB7biBFYIFGJ3CP5-tqIl2x5EIXmMXTpX38jOAQzyPc5fDrkLacPYZQ/exec";

const STORAGE_PREFIX = "kanjibaby_";
const KEY_SRS        = STORAGE_PREFIX + "srs";
const KEY_WRITE      = STORAGE_PREFIX + "write";
const KEY_MNEMO      = STORAGE_PREFIX + "mnemo";
const KEY_JOYO       = STORAGE_PREFIX + "joyo";
const KEY_EVER_SYNCED = STORAGE_PREFIX + "everSynced";  // "1" se abbiamo mai scaricato dal cloud

// Batch pendente
let _pending     = {};   // { kanji: { srs?, write?, mnemonic? } }
let _flushTimer  = null;

// ============================================================
//  INIT  —  chiamato una volta per pagina, NON asincrono
//  Restituisce subito (localStorage è già disponibile).
//  Se è il primo accesso in assoluto, avvia download cloud in bg.
// ============================================================
function initSync() {
  const hasLocalData = (
    localStorage.getItem(KEY_SRS)   ||
    localStorage.getItem(KEY_WRITE) ||
    localStorage.getItem(KEY_MNEMO)
  );
  const everSynced = localStorage.getItem(KEY_EVER_SYNCED);

  if (!hasLocalData && !everSynced) {
    // Primo accesso assoluto: scarica dal cloud in background
    console.log("[storage] Primo accesso — scarico dal cloud...");
    _pullFromCloud().then(() => {
      localStorage.setItem(KEY_EVER_SYNCED, "1");
    });
  }
  // In tutti gli altri casi non tocchiamo localStorage — usiamo quello che c'è
}

// ── Pull cloud → localStorage (solo primo accesso) ──────────
async function _pullFromCloud() {
  try {
    const res  = await fetch(APPS_SCRIPT_URL + "?action=getAll");
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);

    const data    = json.data || {};
    const srsDB   = {};
    const writeDB = {};
    const mnemo   = {};

    for (const [kanji, rec] of Object.entries(data)) {
      if (rec.srs   && Object.keys(rec.srs).length)   srsDB[kanji]   = rec.srs;
      if (rec.write && Object.keys(rec.write).length) writeDB[kanji] = rec.write;
      if (rec.mnemonic) mnemo[kanji] = rec.mnemonic;
    }

    // Solo se il cloud ha davvero dei dati
    if (Object.keys(srsDB).length)   _save(KEY_SRS,   srsDB);
    if (Object.keys(writeDB).length) _save(KEY_WRITE, writeDB);
    if (Object.keys(mnemo).length)   _save(KEY_MNEMO, mnemo);

    console.log(`[storage] Download cloud completato — ${Object.keys(data).length} kanji`);
  } catch (err) {
    console.warn("[storage] Download cloud fallito:", err.message);
  }
}

// ============================================================
//  FLUSH  —  invia _pending al cloud
// ============================================================
async function flushToCloud() {
  if (Object.keys(_pending).length === 0) return;

  const updates = Object.entries(_pending).map(([kanji, d]) => ({ kanji, ...d }));
  _pending = {};  // svuota subito così nuovi update non vengono persi

  try {
    const res  = await fetch(APPS_SCRIPT_URL, {
      method:  "POST",
      headers: { "Content-Type": "text/plain" }, // Apps Script accetta text/plain come JSON
      body:    JSON.stringify({ action: "save", updates }),
    });
    const json = await res.json();
    if (!json.ok) throw new Error(json.error);
    console.log(`[storage] Cloud: salvati ${json.saved} kanji`);
  } catch (err) {
    console.warn("[storage] Flush fallito:", err.message);
    // Rimetti in coda
    for (const u of updates) {
      _pending[u.kanji] = _pending[u.kanji] || {};
      Object.assign(_pending[u.kanji], u);
    }
  }
}

// Debounce flush: aspetta 3s di inattività prima di inviare
function _scheduleFlush() {
  clearTimeout(_flushTimer);
  _flushTimer = setTimeout(flushToCloud, 3000);
}

function _queueUpdate(kanji, data) {
  _pending[kanji] = _pending[kanji] || {};
  Object.assign(_pending[kanji], data);
  _scheduleFlush();
}

// Flush prima di navigare via
window.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") {
    clearTimeout(_flushTimer);
    flushToCloud();
  }
});

// ============================================================
//  localStorage utils
// ============================================================
function _load(key) {
  try { return JSON.parse(localStorage.getItem(key)) || {}; }
  catch { return {}; }
}
function _save(key, data) {
  try { localStorage.setItem(key, JSON.stringify(data)); }
  catch(e) { console.warn("[storage] Errore:", e); }
}

// ============================================================
//  JOYO FILTER
// ============================================================
function getJoyoFilter() { return localStorage.getItem(KEY_JOYO) !== "0"; }
function setJoyoFilter(v) { localStorage.setItem(KEY_JOYO, v ? "1" : "0"); }

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
  _save(KEY_SRS, db);           // ← localStorage aggiornato subito
  _queueUpdate(kanji, { srs: rec }); // ← cloud in background
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
      const aE = a.srs.totalSeen ? 1-a.srs.totalCorrect/a.srs.totalSeen : 1;
      const bE = b.srs.totalSeen ? 1-b.srs.totalCorrect/b.srs.totalSeen : 1;
      return bE - aE;
    });
}

// ============================================================
//  SCRITTURA  —  ordine RANDOM
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

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length-1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i+1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function getWriteQueue(kanjiList) { return shuffleArray(kanjiList); }

// ============================================================
//  MNEMONICI  —  flush immediato
// ============================================================
function getMnemonic(kanji) { return (_load(KEY_MNEMO))[kanji] || ""; }

function setMnemonic(kanji, text) {
  const db = _load(KEY_MNEMO);
  if (text.trim()) db[kanji] = text.trim(); else delete db[kanji];
  _save(KEY_MNEMO, db);
  _pending[kanji] = _pending[kanji] || {};
  Object.assign(_pending[kanji], { mnemonic: text.trim() });
  clearTimeout(_flushTimer);
  flushToCloud(); // immediato
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
    const sA = s.totalSeen ? s.totalCorrect/s.totalSeen : null;
    const wA = w.totalSeen ? w.totalCorrect/w.totalSeen : null;
    const cb = [sA, wA].filter(v => v !== null);
    const avg = cb.length ? cb.reduce((a,b)=>a+b,0)/cb.length : null;
    let level = 0;
    if      (avg === null) level = 0;
    else if (avg < 0.5)    level = 1;
    else if (avg < 0.75)   level = 2;
    else if (avg < 0.9)    level = 3;
    else                   level = 4;
    result[k] = { srsAcc: sA, writeAcc: wA, avg, level,
                  srsSeen: s.totalSeen, writeSeen: w.totalSeen };
  }
  return result;
}

// ============================================================
//  RESET
// ============================================================
function resetAllData() {
  if (confirm("Cancellare tutti i dati locali?\nI dati sul Google Sheet rimangono intatti.")) {
    [KEY_SRS, KEY_WRITE, KEY_MNEMO, KEY_EVER_SYNCED].forEach(k => localStorage.removeItem(k));
    _pending = {};
    alert("Cache locale cancellata. Ricarica la pagina.");
  }
}
