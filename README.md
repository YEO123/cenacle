# Cénacle — Dashboard

Tableau de bord de gestion des membres de l'Apostolat Missionnaire du Cénacle.
Ajout, modification et suppression via un formulaire en popup.

**Stack :** Node.js 24 + Express, SQLite (`node:sqlite`), HTML/CSS/JS.

## Lancer avec Docker

```bash
docker compose up -d --build
```

Puis ouvrir http://localhost:3000. Les données sont conservées dans le volume `cenacle-data`.

## Lancer sans Docker

```bash
npm install
npm start
```
