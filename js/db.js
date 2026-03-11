// ============================================================
//  db.js  —  KanjiBaby database loader v3
//  Gestisce: Kanji sheet (CSV pub) + 10k sheet (Apps Script)
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

// ── Struttura colonne kanji ──────────────────────────────────
// 0:Kanji 1:Keyword 2:Meanings 3:On 4:Kun 5:Joyo
// 6,7,8: parola1,lettura1,significato1 ... × 10
function rowToKanji(cols, index) {
  const words = [];
  for (let i = 0; i < 10; i++) {
    const base = 6 + i * 3;
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
    words,
  };
}

// ── Caricamento kanji ────────────────────────────────────────
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
      console.log(`[KanjiBaby] DB kanji: ${data.length}`);
      return data;
    })
    .catch(err => {
      console.error('[KanjiBaby] Errore DB kanji:', err);
      window.KANJI_DB = []; return [];
    });
  return _dbReady;
}

// ── Caricamento 10k via Apps Script ─────────────────────────
let _10kReady = null;

async function load10k() {
  if (window.TENK_DB) return window.TENK_DB;
  if (_10kReady) return _10kReady;
  _10kReady = fetch(APPS_SCRIPT_URL + '?action=getWords10k')
    .then(r => r.json())
    .then(json => {
      if (!json.ok) throw new Error(json.error);
      window.TENK_DB = json.data;
      console.log(`[KanjiBaby] DB 10k: ${json.data.length}`);
      return json.data;
    })
    .catch(err => {
      console.error('[KanjiBaby] Errore 10k:', err);
      window.TENK_DB = []; return [];
    });
  return _10kReady;
}

// ── Helper kanji ─────────────────────────────────────────────
function findKanji(char) { return (window.KANJI_DB||[]).find(k=>k.kanji===char)||null; }

function getActiveKanji() {
  const db = window.KANJI_DB || [];
  return getJoyoFilter() ? db.filter(k => k.joyo) : db;
}

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
