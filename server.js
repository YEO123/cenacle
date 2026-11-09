import express from 'express';
import { DatabaseSync } from 'node:sqlite';
import { createHash, randomBytes, scrypt, scryptSync, timingSafeEqual } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { promisify } from 'node:util';
import QRCode from 'qrcode';
import { COUNTRY_CODES, DIAL_CODES, FRENCH_NUMBERING } from './public/pays.js';
import { normalize, zoneOf } from './regions.js';

const PORT = process.env.PORT || 3000;
const DATA_DIR = process.env.DATA_DIR || './data';
const { ADMIN_USER, ADMIN_PASSWORD } = process.env;
const PUBLIC_URL = (process.env.PUBLIC_URL || '').replace(/\/$/, '');

if (!ADMIN_USER || !ADMIN_PASSWORD || ADMIN_PASSWORD.length < 12) {
  console.error('ADMIN_USER et ADMIN_PASSWORD (12 caractères minimum) sont obligatoires : voir .env.example');
  process.exit(1);
}

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

db.exec(`
  CREATE TABLE IF NOT EXISTS inscriptions (
    id                   INTEGER PRIMARY KEY AUTOINCREMENT,
    nom                  TEXT NOT NULL,
    prenoms              TEXT NOT NULL,
    adresse              TEXT NOT NULL,
    code_postal          TEXT NOT NULL,
    ville                TEXT NOT NULL,
    pays                 TEXT NOT NULL,
    date_naissance       TEXT NOT NULL,
    telephone            TEXT NOT NULL DEFAULT '',
    email                TEXT NOT NULL DEFAULT '',
    consentement_at      TEXT NOT NULL,
    consentement_version TEXT NOT NULL,
    dedupe_key           TEXT NOT NULL UNIQUE,
    created_at           TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  );
`);

const inscriptionCols = db.prepare('PRAGMA table_info(inscriptions)').all().map((c) => c.name);
if (!inscriptionCols.includes('telephone')) db.exec("ALTER TABLE inscriptions ADD COLUMN telephone TEXT NOT NULL DEFAULT ''");
if (!inscriptionCols.includes('email')) db.exec("ALTER TABLE inscriptions ADD COLUMN email TEXT NOT NULL DEFAULT ''");

const FIELDS = ['nom', 'prenom', 'email', 'telephone', 'adresse', 'sexe', 'anniversaire'];

function clean(body) {
  const data = {};
  for (const f of FIELDS) data[f] = (body?.[f] ?? '').toString().trim();
  if (!data.nom || !data.prenom) return { error: 'Le nom et le prénom sont obligatoires.' };
  if (!['F', 'M'].includes(data.sexe)) return { error: 'Le sexe doit être F ou M.' };
  if (data.anniversaire && !/^\d{4}-\d{2}-\d{2}$/.test(data.anniversaire)) return { error: "Date d'anniversaire invalide." };
  return { data };
}

// À incrémenter si le texte de la case de consentement change dans public/index.html
const CONSENT_VERSION = 'v1';
const INSCRIPTION_FIELDS = ['nom', 'prenoms', 'adresse', 'code_postal', 'ville', 'pays', 'date_naissance', 'telephone', 'email'];
const MAX_LENGTH = 200;

function isValidBirthDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return false;
  return value >= '1900-01-01' && date <= new Date();
}

// Le 0 initial n'est retiré qu'en numérotation française : ailleurs il peut faire partie du numéro (Côte d'Ivoire, Italie…)
function formatPhone(indicatif, raw) {
  if (!Object.hasOwn(DIAL_CODES, indicatif)) return null;
  const dial = DIAL_CODES[indicatif];
  let digits = raw.replace(/[\s().-]/g, '');
  if (!/^\d+$/.test(digits)) return null;
  if (FRENCH_NUMBERING.includes(indicatif)) {
    digits = digits.replace(/^0/, '');
    if (digits.length !== 9) return null;
  } else if (digits.length < 4 || digits.length + dial.length > 15) {
    return null;
  }
  return `+${dial} ${digits}`;
}

function cleanInscription(body) {
  const data = {};
  for (const f of INSCRIPTION_FIELDS) data[f] = (body?.[f] ?? '').toString().trim();
  if (INSCRIPTION_FIELDS.some((f) => data[f].length > MAX_LENGTH)) return { error: 'Un des champs est trop long.' };
  if (['nom', 'prenoms', 'adresse', 'ville', 'telephone'].some((f) => !data[f])) return { error: 'Merci de remplir tous les champs.' };
  if (!COUNTRY_CODES.includes(data.pays)) return { error: 'Pays invalide.' };
  if (data.pays === 'FR' && !/^\d{5}$/.test(data.code_postal)) return { error: 'Le code postal doit contenir 5 chiffres.' };
  if (!isValidBirthDate(data.date_naissance)) return { error: 'Date de naissance invalide.' };
  data.telephone = formatPhone(String(body?.indicatif ?? ''), data.telephone);
  if (!data.telephone) return { error: "Numéro de téléphone invalide. Saisissez-le sans l'indicatif." };
  if (data.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) return { error: 'Adresse email invalide.' };
  if (body?.consentement !== true) return { error: 'La case de consentement doit être cochée pour enregistrer vos données.' };
  return { data };
}

function createLimiter(max, windowMs) {
  const hits = new Map();
  return {
    blocked(key) {
      const entry = hits.get(key);
      return Boolean(entry && entry.resetAt > Date.now() && entry.count >= max);
    },
    add(key) {
      if (hits.size > 10000) hits.clear();
      const entry = hits.get(key);
      if (entry && entry.resetAt > Date.now()) entry.count += 1;
      else hits.set(key, { count: 1, resetAt: Date.now() + windowMs });
    },
    reset(key) {
      hits.delete(key);
    },
  };
}
const loginLimiter = createLimiter(10, 15 * 60 * 1000);
// Large : tout un public peut partager la même IP sur le Wi-Fi ou le réseau mobile de la salle
const inscriptionLimiter = createLimiter(120, 60 * 1000);

const SESSION_COOKIE = 'cenacle_session';
const SESSION_MS = 8 * 60 * 60 * 1000;
const scryptAsync = promisify(scrypt);
const passwordSalt = randomBytes(16);
const passwordHash = scryptSync(ADMIN_PASSWORD, passwordSalt, 64);
const sha256 = (value) => createHash('sha256').update(String(value)).digest();

async function checkCredentials(username, password) {
  const hash = await scryptAsync(String(password ?? ''), passwordSalt, 64);
  const passwordOk = timingSafeEqual(hash, passwordHash);
  const userOk = timingSafeEqual(sha256(username ?? ''), sha256(ADMIN_USER));
  return passwordOk && userOk;
}

function sessionToken(req) {
  for (const part of (req.headers.cookie || '').split(';')) {
    const [name, value] = part.trim().split('=');
    if (name === SESSION_COOKIE && value) return value;
  }
  return null;
}

function isLoggedIn(req) {
  const token = sessionToken(req);
  if (!token) return false;
  const row = db
    .prepare('SELECT 1 FROM sessions WHERE token_hash = ? AND expires_at > ?')
    .get(sha256(token).toString('hex'), Date.now());
  return Boolean(row);
}

function sessionCookie(value, maxAgeSeconds) {
  const secure = PUBLIC_URL.startsWith('https://') ? '; Secure' : '';
  return `${SESSION_COOKIE}=${value}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSeconds}${secure}`;
}

function requireApi(req, res, next) {
  if (!isLoggedIn(req)) return res.status(401).json({ error: 'Connexion requise' });
  res.set('Cache-Control', 'no-store');
  next();
}

function requirePage(req, res, next) {
  if (!isLoggedIn(req)) return res.redirect('/login');
  res.set('Cache-Control', 'no-store');
  next();
}

const app = express();
if (process.env.TRUST_PROXY === '1') app.set('trust proxy', 1);

app.use((req, res, next) => {
  res.set({
    'Content-Security-Policy':
      "default-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'same-origin',
  });
  next();
});
app.use(express.json({ limit: '20kb' }));

app.get('/login', (req, res, next) => (isLoggedIn(req) ? res.redirect('/admin/') : next()));
app.use(express.static('public', { extensions: ['html'] }));
app.use('/admin', requirePage, express.static('private', { index: 'admin.html', extensions: ['html'] }));

app.post('/api/login', async (req, res) => {
  if (loginLimiter.blocked(req.ip)) {
    return res.status(429).json({ error: 'Trop de tentatives. Réessayez dans 15 minutes.' });
  }
  if (!(await checkCredentials(req.body?.username, req.body?.password))) {
    loginLimiter.add(req.ip);
    return res.status(401).json({ error: 'Identifiant ou mot de passe incorrect.' });
  }
  loginLimiter.reset(req.ip);
  db.prepare('DELETE FROM sessions WHERE expires_at <= ?').run(Date.now());
  const token = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (token_hash, expires_at) VALUES (?, ?)').run(
    sha256(token).toString('hex'),
    Date.now() + SESSION_MS
  );
  res.set('Set-Cookie', sessionCookie(token, SESSION_MS / 1000));
  res.status(204).end();
});

app.post('/api/logout', (req, res) => {
  const token = sessionToken(req);
  if (token) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(sha256(token).toString('hex'));
  res.set('Set-Cookie', sessionCookie('', 0));
  res.status(204).end();
});

app.post('/api/inscriptions', (req, res) => {
  if (inscriptionLimiter.blocked(req.ip)) {
    return res.status(429).json({ error: 'Trop de demandes. Réessayez dans une minute.' });
  }
  inscriptionLimiter.add(req.ip);
  // Champ invisible rempli uniquement par les robots : on répond comme si tout allait bien
  if (req.body?.site_web) return res.status(201).json({ ok: true });
  const { data, error } = cleanInscription(req.body);
  if (error) return res.status(400).json({ error });
  // Une personne qui scanne deux fois n'est enregistrée qu'une fois
  const dedupeKey = [normalize(data.nom), normalize(data.prenoms), data.date_naissance].join('|');
  db.prepare(
    `INSERT OR IGNORE INTO inscriptions
       (nom, prenoms, adresse, code_postal, ville, pays, date_naissance, telephone, email,
        consentement_at, consentement_version, dedupe_key)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?, ?)`
  ).run(...INSCRIPTION_FIELDS.map((f) => data[f]), CONSENT_VERSION, dedupeKey);
  res.status(201).json({ ok: true });
});

app.get('/api/inscriptions', requireApi, (req, res) => {
  const rows = db.prepare('SELECT * FROM inscriptions ORDER BY id DESC').all();
  res.json(rows.map(({ dedupe_key, ...row }) => ({ ...row, zone: zoneOf(row) })));
});

app.delete('/api/inscriptions/:id', requireApi, (req, res) => {
  const r = db.prepare('DELETE FROM inscriptions WHERE id = ?').run(req.params.id);
  if (r.changes === 0) return res.status(404).json({ error: 'Introuvable' });
  res.status(204).end();
});

app.get('/api/qr', requireApi, async (req, res) => {
  const url = `${PUBLIC_URL || `${req.protocol}://${req.get('host')}`}/`;
  const image = await QRCode.toDataURL(url, { width: 800, margin: 2, errorCorrectionLevel: 'M' });
  res.json({ url, image });
});

app.use('/api/membres', requireApi);

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

app.use((err, req, res, next) => {
  if (err.type === 'entity.parse.failed' || err.type === 'entity.too.large') {
    return res.status(400).json({ error: 'Requête invalide' });
  }
  console.error(err);
  res.status(500).json({ error: 'Erreur serveur' });
});

app.listen(PORT, () => console.log(`Cenacle dashboard sur http://localhost:${PORT}`));
