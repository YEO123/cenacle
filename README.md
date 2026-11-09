# Cénacle — Dashboard

Recensement des participants aux événements de l'Apostolat Missionnaire du Cénacle.

- `/` : formulaire d'inscription public, ouvert par QR code
- `/login` puis `/admin/` : chiffres, graphiques, liste des inscrits et QR code à imprimer
- `/admin/membres` : gestion des membres

**Stack :** Node.js 24 + Express, SQLite (`node:sqlite`), HTML/CSS/JS.

## Configuration

Copier `.env.example` en `.env` et renseigner `ADMIN_USER` et `ADMIN_PASSWORD`. Sans ces valeurs, le serveur ne démarre pas.

## Lancer avec Docker

```bash
docker compose up -d --build
```

Puis ouvrir http://localhost:3000 (port modifiable avec `APP_PORT` dans `.env`). Les données sont conservées dans le volume `cenacle-data`.

## Lancer sans Docker

```bash
npm install
node --env-file=.env server.js
```
