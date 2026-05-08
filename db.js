// SQLite intégré à Node.js 22+ (node:sqlite) — aucune dépendance externe
const { DatabaseSync } = require('node:sqlite');
const path = require('path');

const db = new DatabaseSync(path.join(__dirname, 'agenda.db'));

function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS rendez_vous (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      date        TEXT NOT NULL,
      heure       TEXT NOT NULL,
      nom         TEXT NOT NULL,
      prenom      TEXT NOT NULL,
      telephone   TEXT,
      email       TEXT NOT NULL,
      description TEXT,
      created_at  TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS config (
      cle    TEXT PRIMARY KEY,
      valeur TEXT NOT NULL
    );

    INSERT OR IGNORE INTO config VALUES ('jours_ouverts', '1,2,3,4,5');
    INSERT OR IGNORE INTO config VALUES ('heure_debut',   '09:00');
    INSERT OR IGNORE INTO config VALUES ('heure_fin',     '18:00');
  `);
}

function getConfig() {
  const rows = db.prepare('SELECT cle, valeur FROM config').all();
  return Object.fromEntries(rows.map(r => [r.cle, r.valeur]));
}

function setConfig({ jours_ouverts, heure_debut, heure_fin }) {
  const stmt = db.prepare('INSERT OR REPLACE INTO config VALUES (?, ?)');
  stmt.run('jours_ouverts', jours_ouverts);
  stmt.run('heure_debut',   heure_debut);
  stmt.run('heure_fin',     heure_fin);
}

function getRendezVousByDate(date) {
  return db.prepare('SELECT * FROM rendez_vous WHERE date = ?').all(date);
}

function getAllRendezVous() {
  return db.prepare('SELECT * FROM rendez_vous ORDER BY date DESC, heure ASC').all();
}

function createRendezVous({ date, heure, nom, prenom, telephone, email, description }) {
  const result = db.prepare(`
    INSERT INTO rendez_vous (date, heure, nom, prenom, telephone, email, description)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(date, heure, nom, prenom, telephone || '', email, description || '');
  return { id: result.lastInsertRowid, date, heure, nom, prenom, email };
}

function deleteRendezVous(id) {
  db.prepare('DELETE FROM rendez_vous WHERE id = ?').run(id);
}

module.exports = {
  initDb, getConfig, setConfig,
  getRendezVousByDate, getAllRendezVous,
  createRendezVous, deleteRendezVous
};
