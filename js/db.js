// ============================================================
//  db.js  —  KanjiBaby database loader v2
//  Struttura colonne aggiornata:
//  0:Kanji 1:Heisig Keyword 2:Meanings 3:On-yomi 4:Kun-yomi
//  5:Joyo  6:parola1 7:lettura1 8:significato1 ... (x10, ogni parola = 3 col)
// ============================================================

const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRlyobVlr1JstJZHwgXLJv1wvNJJS41KDDLIIL8Ob2OzpTN-Wt2YjQh9l97t9Hu0CR7ISMPihmQ8aFl/pub?output=csv";

// ── Parser CSV robusto ───────────────────────────────────────
function parseCSV(text) {
  const rows = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cols = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQ && line[i+1] === '"') { cur += '"'; i++; }
        else inQ = !inQ;
      } else if (ch === ',' && !inQ) { cols.push(cur.trim()); cur = ''; }
      else cur += ch;
    }
    cols.push(cur.trim());
    rows.push(cols);
  }
  return rows;
}

// ── Mappa riga CSV → oggetto kanji ───────────────────────────
function rowToKanji(cols, index) {
  const words = [];
  for (let i = 0; i < 10; i++) {
    const base    = 6 + i * 3;
    const word    = (cols[base]     || '').trim();
    const reading = (cols[base + 1] || '').trim();
    const meaning = (cols[base + 2] || '').trim();
    if (word) words.push({ word, reading, meaning });
  }

  return {
    id:       index,
    kanji:    (cols[0] || '').trim(),
    keyword:  (cols[1] || '').trim(),
    meanings: (cols[2] || '').trim(),
    on:       (cols[3] || '').trim(),
    kun:      (cols[4] || '').trim(),
    joyo:     (cols[5] || '').trim() === '1',
    words,                              // [{word, reading, meaning}, ...]
  };
}

// ── Caricamento asincrono ────────────────────────────────────
let _dbReady = null;

async function loadDB() {
  if (window.KANJI_DB) return window.KANJI_DB;
  if (_dbReady) return _dbReady;

  _dbReady = fetch(SHEET_CSV_URL)
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.text(); })
    .then(text => {
      const rows = parseCSV(text);
      const data = rows.slice(1)
        .filter(r => r[0] && r[0].trim())
        .map((r, i) => rowToKanji(r, i + 1));
      window.KANJI_DB = data;
      console.log(`[KanjiBaby] DB: ${data.length} kanji`);
      return data;
    })
    .catch(err => {
      console.error('[KanjiBaby] Errore DB:', err);
      window.KANJI_DB = [];
      return [];
    });

  return _dbReady;
}

// ── Helper: cerca kanji per carattere ───────────────────────
function findKanji(char) {
  return (window.KANJI_DB || []).find(k => k.kanji === char) || null;
}

// ── Helper: filtra per joyo ──────────────────────────────────
function getActiveKanji() {
  const db   = window.KANJI_DB || [];
  const joyo = getJoyoFilter();
  return joyo ? db.filter(k => k.joyo) : db;
}

// ── Helper: tutte le parole flat [{word,reading,meaning,kanji}]
function getAllWords() {
  const db = window.KANJI_DB || [];
  const out = [];
  for (const k of db) {
    for (const w of k.words) {
      if (w.word) out.push({ ...w, kanji: k.kanji });
    }
  }
  return out;
}
