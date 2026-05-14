# Déploiement Prime Athl Backend

## 🏠 Local (test rapide)

```
cd backend
npm install
npm start
```

Backend tourne sur `http://localhost:3001`. Il sert aussi le frontend (`Muscu.html`).

Pour que ton tel y accède (LAN) : `http://192.168.1.4:3001/Muscu.html`
(NordVPN OFF + pare-feu Windows ouvert sur 3001).

⚠️ **Limites du local** : ton PC doit rester allumé. Tes athlètes ne peuvent se connecter que s'ils sont sur ton Wi-Fi. **Pour de vrais athlètes à distance → déploie en cloud (gratuit).**

## ☁️ Déploiement Render.com (recommandé, gratuit)

1. Push le dossier `backend/` sur un repo GitHub privé
2. Va sur https://render.com → "New +" → "Web Service"
3. Connecte ton repo GitHub
4. Configuration :
   - **Build Command** : `npm install`
   - **Start Command** : `npm start`
   - **Instance Type** : Free
   - **Environment Variables** :
     - `JWT_SECRET` = (génère 32 chars random)
     - `PORT` = (laisse vide, Render le fixe)
5. Deploy

⚠️ Render free tier dort après 15 min d'inactivité (premier réveil ~30 s) et le système de fichiers est **éphémère** : ta DB SQLite sera perdue à chaque redéploiement. Pour de la vraie prod :
- Soit migrer vers Postgres (Render Postgres free 90 j puis 7$/mo, ou Neon free 0.5GB illimité)
- Soit Fly.io avec volume persistant

## 🚀 Déploiement Fly.io (alternative, persistant gratuit)

1. Installe la CLI : https://fly.io/docs/hands-on/install-flyctl/
2. `cd backend && fly launch` (suis le wizard)
3. Crée un volume pour la DB : `fly volumes create data --size 1`
4. Edit `fly.toml` pour mounter le volume sur `/data`, ajoute `DB_PATH=/data/data.db` env
5. `fly deploy`

## 🔐 Sécurité prod

Avant de mettre en prod :
- Régénère un `JWT_SECRET` long (32+ chars) et garde-le secret
- Configure CORS pour autoriser uniquement ton domaine frontend
- Ajoute un rate limit (`express-rate-limit`) sur les routes auth
- Active HTTPS (Render et Fly le font automatiquement)
