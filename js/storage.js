// ============================================================
//  storage.js  —  KanjiBaby local storage manager
//  Tutte le statistiche e preferenze vivono in localStorage.
//  Nessuna scrittura al Google Sheet.
// ============================================================

const STORAGE_PREFIX = "kanjibaby_";

// ── chiavi ───────────────────────────────────────────────────
const KEY_SRS      = STORAGE_PREFIX + "srs";       // oggetto { kanji: SRSRecord }
const KEY_WRITE    = STORAGE_PREFIX + "write";     // oggetto { kanji: WriteRecord }
const KEY_MNEMO    = STORAGE_PREFIX + "mnemo";     // oggetto { kanji: "stringa" }
const KEY_JOYO     = STORAGE_PREFIX + "joyo";      // "1" | "0"

// ============================================================
//  Serializzazione generica
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
function getJoyoFilter() {
  return localStorage.getItem(KEY_JOYO) !== "0";   // default: solo joyo
}
function setJoyoFilter(enabled) {
  localStorage.setItem(KEY_JOYO, enabled ? "1" : "0");
}

// ============================================================
//  SRS  (algoritmo SM-2)
//  SRSRecord: {
//    interval:    giorni prima della prossima ripetizione
//    easiness:    fattore facilità (default 2.5)
//    repetitions: quante volte consecutive risposto corretto
//    dueDate:     ISO string della prossima data di studio
//    totalSeen:   quante volte mostrato
//    totalCorrect: quante risposte corrette
//  }
// ============================================================
const SRS_DEFAULT = {
  interval: 0,
  easiness: 2.5,
  repetitions: 0,
  dueDate: new Date(0).toISOString(),   // subito disponibile
  totalSeen: 0,
  totalCorrect: 0,
};

function getSRSRecord(kanji) {
  const db = _load(KEY_SRS);
  return Object.assign({}, SRS_DEFAULT, db[kanji] || {});
}

function updateSRS(kanji, correct) {
  const db = _load(KEY_SRS);
  const rec = Object.assign({}, SRS_DEFAULT, db[kanji] || {});

  rec.totalSeen++;
  if (correct) rec.totalCorrect++;

  // SM-2
  const q = correct ? 4 : 1;           // quality: 4 = ricordato, 1 = dimenticato
  rec.easiness = Math.max(
    1.3,
    rec.easiness + 0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)
  );

  if (!correct) {
    rec.interval = 0;
    rec.repetitions = 0;
  } else {
    if (rec.repetitions === 0)      rec.interval = 1;
    else if (rec.repetitions === 1) rec.interval = 6;
    else rec.interval = Math.round(rec.interval * rec.easiness);
    rec.repetitions++;
  }

  const due = new Date();
  due.setDate(due.getDate() + rec.interval);
  rec.dueDate = due.toISOString();

  db[kanji] = rec;
  _save(KEY_SRS, db);
  return rec;
}

// Ritorna i kanji "in scadenza" oggi (o mai visti), ordinati per priorità
function getDueKanji(kanjiList) {
  const db    = _load(KEY_SRS);
  const now   = new Date();

  return kanjiList
    .map(k => {
      const rec = Object.assign({}, SRS_DEFAULT, db[k.kanji] || {});
      return { ...k, srs: rec };
    })
    .filter(k => new Date(k.srs.dueDate) <= now)
    .sort((a, b) => {
      // Prima i mai visti, poi per data di scadenza, poi per tasso errore
      const aNever = a.srs.totalSeen === 0;
      const bNever = b.srs.totalSeen === 0;
      if (aNever && !bNever) return -1;
      if (!aNever && bNever) return  1;
      const dateDiff = new Date(a.srs.dueDate) - new Date(b.srs.dueDate);
      if (dateDiff !== 0) return dateDiff;
      const aErr = a.srs.totalSeen ? 1 - a.srs.totalCorrect / a.srs.totalSeen : 1;
      const bErr = b.srs.totalSeen ? 1 - b.srs.totalCorrect / b.srs.totalSeen : 1;
      return bErr - aErr;
    });
}

// ============================================================
//  STATISTICHE SCRITTURA
//  WriteRecord: { totalSeen, totalCorrect }
// ============================================================
function getWriteRecord(kanji) {
  const db = _load(KEY_WRITE);
  return db[kanji] || { totalSeen: 0, totalCorrect: 0 };
}

function updateWrite(kanji, correct) {
  const db  = _load(KEY_WRITE);
  const rec = db[kanji] || { totalSeen: 0, totalCorrect: 0 };
  rec.totalSeen++;
  if (correct) rec.totalCorrect++;
  db[kanji] = rec;
  _save(KEY_WRITE, db);
  return rec;
}

// ============================================================
//  MNEMONICI
// ============================================================
function getMnemonic(kanji) {
  const db = _load(KEY_MNEMO);
  return db[kanji] || "";
}

function setMnemonic(kanji, text) {
  const db = _load(KEY_MNEMO);
  if (text.trim()) db[kanji] = text.trim();
  else delete db[kanji];
  _save(KEY_MNEMO, db);
}

// ============================================================
//  STATISTICHE GLOBALI  (per la pagina di riepilogo)
//  Restituisce un oggetto { kanji: { srsAcc, writeAcc, level } }
//  level: 0–4  (0=mai visto, 1=scarso, 2=medio, 3=buono, 4=ottimo)
// ============================================================
function getAllStats() {
  const srsDB   = _load(KEY_SRS);
  const writeDB = _load(KEY_WRITE);
  const result  = {};

  const allKanji = new Set([
    ...Object.keys(srsDB),
    ...Object.keys(writeDB),
  ]);

  for (const k of allKanji) {
    const s = Object.assign({}, SRS_DEFAULT, srsDB[k] || {});
    const w = writeDB[k] || { totalSeen: 0, totalCorrect: 0 };

    const srsAcc   = s.totalSeen   ? s.totalCorrect   / s.totalSeen   : null;
    const writeAcc = w.totalSeen   ? w.totalCorrect    / w.totalSeen   : null;

    // Combina le due accuratezze (se disponibili)
    const combined = [srsAcc, writeAcc].filter(v => v !== null);
    const avg      = combined.length ? combined.reduce((a,b)=>a+b,0)/combined.length : null;

    let level = 0;
    if      (avg === null)  level = 0;   // mai visto
    else if (avg < 0.5)     level = 1;   // scarso
    else if (avg < 0.75)    level = 2;   // medio
    else if (avg < 0.9)     level = 3;   // buono
    else                    level = 4;   // ottimo

    result[k] = { srsAcc, writeAcc, avg, level,
                  srsSeen: s.totalSeen, writeSeen: w.totalSeen };
  }
  return result;
}

// ============================================================
//  RESET (utility per debug)
// ============================================================
function resetAllData() {
  if (confirm("Sei sicuro di voler cancellare tutti i dati di studio?")) {
    localStorage.removeItem(KEY_SRS);
    localStorage.removeItem(KEY_WRITE);
    localStorage.removeItem(KEY_MNEMO);
    alert("Dati cancellati.");
  }
}
