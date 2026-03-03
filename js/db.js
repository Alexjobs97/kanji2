// ============================================================
//  db.js  —  KanjiBaby database loader
//  Carica il Google Sheet pubblicato come CSV e restituisce
//  un array globale window.KANJI_DB di oggetti kanji.
// ============================================================

const SHEET_CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vRlyobVlr1JstJZHwgXLJv1wvNJJS41KDDLIIL8Ob2OzpTN-Wt2YjQh9l97t9Hu0CR7ISMPihmQ8aFl/pub?output=csv";

// ============================================================
//  Parser CSV robusto (gestisce virgolette e virgole interne)
// ============================================================
function parseCSV(text) {
  const rows = [];
  const lines = text.split(/\r?\n/);

  for (const line of lines) {
    if (!line.trim()) continue;
    const cols = [];
    let cur = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
        else inQuotes = !inQuotes;
      } else if (ch === "," && !inQuotes) {
        cols.push(cur.trim());
        cur = "";
      } else {
        cur += ch;
      }
    }
    cols.push(cur.trim());
    rows.push(cols);
  }
  return rows;
}

// ============================================================
//  Converti ogni riga CSV in un oggetto kanji strutturato
// ============================================================
function rowToKanji(cols, index) {
  // Colonne: Kanji | Heisig Keyword | Meanings | On-yomi | Kun-yomi |
  //          word1 … word10 | Joyo
  const words = [];
  for (let i = 5; i <= 14; i++) {
    if (cols[i] && cols[i].trim()) words.push(cols[i].trim());
  }

  return {
    id: index,                                    // posizione Heisig (1-based)
    kanji:   cols[0]  || "",
    keyword: cols[1]  || "",                      // Heisig keyword
    meanings: cols[2] || "",                      // significati separati da virgola/slash
    on:      cols[3]  || "",                      // on-yomi
    kun:     cols[4]  || "",                      // kun-yomi
    words:   words,                               // parole comuni (max 10)
    joyo:    cols[15] !== undefined               // colonna Joyo (0 o 1)
               ? cols[15].trim() === "1"
               : true,                           // default true se colonna mancante
  };
}

// ============================================================
//  Caricamento asincrono  —  espone window.KANJI_DB
//  Ritorna una Promise così le pagine possono fare:
//    await loadDB();
// ============================================================
let _dbReady = null;

async function loadDB() {
  if (window.KANJI_DB) return window.KANJI_DB;   // già caricato
  if (_dbReady) return _dbReady;                 // caricamento in corso

  _dbReady = fetch(SHEET_CSV_URL)
    .then(r => {
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      return r.text();
    })
    .then(text => {
      const rows = parseCSV(text);
      // La prima riga è l'intestazione — la saltiamo
      const header = rows[0];
      const data   = rows.slice(1)
        .filter(r => r[0] && r[0].trim())          // salta righe vuote
        .map((r, i) => rowToKanji(r, i + 1));

      window.KANJI_DB = data;
      window.KANJI_HEADER = header;
      console.log(`[KanjiBaby] DB caricato: ${data.length} kanji`);
      return data;
    })
    .catch(err => {
      console.error("[KanjiBaby] Errore caricamento DB:", err);
      window.KANJI_DB = [];
      return [];
    });

  return _dbReady;
}

// ============================================================
//  Helper: cerca kanji per carattere
// ============================================================
function findKanji(char) {
  return (window.KANJI_DB || []).find(k => k.kanji === char) || null;
}

// ============================================================
//  Helper: filtra per joyo (rispetta il toggle globale)
// ============================================================
function getActiveKanji() {
  const db = window.KANJI_DB || [];
  const joyo = getJoyoFilter();           // da storage.js
  return joyo ? db.filter(k => k.joyo) : db;
}
