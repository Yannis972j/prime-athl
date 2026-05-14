# Prime Athl

App de coaching avec sync temps réel coach ↔ athlète.

## 🚀 Déploiement Render (URL stable 24/7)

### 1. Créer un compte GitHub (si pas déjà fait)
- Va sur https://github.com → **Sign up**
- Confirme ton email

### 2. Créer un repo
- Sur GitHub, en haut à droite → **+ → New repository**
- Nom : `prime-athl` (ou ce que tu veux)
- **Private** (recommandé)
- ❌ Ne coche pas "Add a README"
- Clique **Create repository**

### 3. Push le code (depuis ce PC)
Ouvre PowerShell dans `C:\Users\User\Desktop\mes_apps` et lance :

```bash
git init
git add .
git commit -m "Initial commit"
git branch -M main
git remote add origin https://github.com/TON_PSEUDO/prime-athl.git
git push -u origin main
```

(Remplace `TON_PSEUDO` par ton vrai username GitHub.)

À la première fois, Git demandera tes identifiants GitHub → utilise un **token** :
- GitHub → Settings → Developer settings → Personal access tokens (classic) → Generate new token → coche `repo` → copie-colle dans le terminal quand demandé.

### 4. Créer le service Render
- Va sur https://render.com → **Sign up** (avec ton GitHub)
- Autorise Render à voir ton repo `prime-athl`
- Dashboard Render → **New +** → **Web Service**
- Sélectionne le repo `prime-athl` → **Connect**
- Render détecte automatiquement le `render.yaml` → **Apply**
- Patiente 3-5 min pour le 1er build

### 5. Récupérer l'URL et tester
- Une fois "Live", Render donne une URL : `https://prime-athl.onrender.com`
- Ouvre-la → tu vois l'écran de connexion
- **Inscris-toi** avec ton email `yannisgym972@gmail.com` → tu es auto-promu coach principal

### 6. Mettre à jour le QR pour partager
Sur ce PC, dans `muscu/` :
```bash
node -e "const fs=require('fs');const QRCode=require('qrcode');QRCode.toBuffer('https://prime-athl.onrender.com/Muscu.html',{width:520,margin:1},(e,buf)=>{const b64=buf.toString('base64');let h=fs.readFileSync('qr.html','utf8');h=h.replace(/src=\"data:image\/png;base64,[^\"]+\"/,'src=\"data:image/png;base64,'+b64+'\"');h=h.replace(/http[s]?:\/\/[^\"<\s]+\.html/g,'https://prime-athl.onrender.com/Muscu.html');fs.writeFileSync('qr.html',h);})"
```

## ⚠️ Limites du tier gratuit Render
- **Spin down après 15 min d'inactivité** → 1re requête après pause prend ~30 s
- **Disque éphémère** → `data.json` se réinitialise à chaque redéploiement
  → Pour persistance : ajoute un Render Disk (~$0.25/mo) et passe la variable `DB_PATH=/data/data.json`

## 🔄 Mettre à jour le code après modif
```bash
git add .
git commit -m "ce que j'ai changé"
git push
```
Render redéploie automatiquement en 2-3 min.
