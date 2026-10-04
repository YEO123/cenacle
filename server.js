import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || './data';
mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(path.join(DATA_DIR, 'cenacle.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS membres (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    nom        TEXT NOT NULL,
    prenom     TEXT NOT NULL,
    email      TEXT,
    telephone  TEXT,
    adresse    TEXT,
    sexe       TEXT CHECK (sexe IN ('F', 'M')),
    anniversaire TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`);

// Migration des bases existantes : ajoute adresse/sexe, retire role/statut
const cols = db.prepare('PRAGMA table_info(membres)').all().map((c) => c.name);
if (!cols.includes('adresse')) db.exec('ALTER TABLE membres ADD COLUMN adresse TEXT');
if (!cols.includes('sexe')) db.exec("ALTER TABLE membres ADD COLUMN sexe TEXT CHECK (sexe IN ('F', 'M'))");
if (!cols.includes('anniversaire')) db.exec('ALTER TABLE membres ADD COLUMN anniversaire TEXT');
if (cols.includes('role')) db.exec('ALTER TABLE membres DROP COLUMN role');
if (cols.includes('statut')) db.exec('ALTER TABLE membres DROP COLUMN statut');

const FIELDS = ['nom', 'prenom', 'email', 'telephone', 'adresse', 'sexe', 'anniversaire'];

function clean(body) {
  const data = {};
  for (const f of FIELDS) data[f] = (body?.[f] ?? '').toString().trim();
  if (!data.nom || !data.prenom) return { error: 'Le nom et le prénom sont obligatoires.' };
  if (!['F', 'M'].includes(data.sexe)) return { error: 'Le sexe doit être F ou M.' };
  if (data.anniversaire && !/^\d{4}-\d{2}-\d{2}$/.test(data.anniversaire)) return { error: "Date d'anniversaire invalide." };
  return { data };
}

const app = express();
app.use(express.json());
app.use(express.static('public'));

app.get('/api/membres', (req, res) => {
  res.json(db.prepare('SELECT * FROM membres ORDER BY id DESC').all());
});

app.post('/api/membres', (req, res) => {
  const { data, error } = clean(req.body);
  if (error) return res.status(400).json({ error });
  const r = db.prepare(
    `INSERT INTO membres (nom, prenom, email, telephone, adresse, sexe, anniversaire)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(...FIELDS.map((f) => data[f]));
  res.status(201).json(db.prepare('SELECT * FROM membres WHERE id = ?').get(r.lastInsertRowid));
});

app.put('/api/membres/:id', (req, res) => {
  const { data, error } = clean(req.body);
  if (error) return res.status(400).json({ error });
  const r = db.prepare(
    `UPDATE membres SET nom = ?, prenom = ?, email = ?, telephone = ?, adresse = ?, sexe = ?, anniversaire = ?
     WHERE id = ?`
  ).run(...FIELDS.map((f) => data[f]), req.params.id);
  if (r.changes === 0) return res.status(404).json({ error: 'Introuvable' });
  res.json(db.prepare('SELECT * FROM membres WHERE id = ?').get(req.params.id));
});

app.delete('/api/membres/:id', (req, res) => {
  const r = db.prepare('DELETE FROM membres WHERE id = ?').run(req.params.id);
  if (r.changes === 0) return res.status(404).json({ error: 'Introuvable' });
  res.status(204).end();
});

app.listen(PORT, () => console.log(`Cenacle dashboard sur http://localhost:${PORT}`));
