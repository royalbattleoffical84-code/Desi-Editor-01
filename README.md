# Desi Editor - Setup Guide (Hinglish)

## Structure
- `backend/server.js` → Express + FFmpeg backend
- `backend/public/index.html` → Frontend UI (same server serve karta hai)

Dono ek hi Railway service pe deploy honge — alag se URL set karne ki zarurat nahi.

## Deploy on Railway

### Option A: GitHub se (recommended)
1. `backend/` folder ka content GitHub repo mein push karo (root mein server.js, package.json, public/ hone chahiye)
2. https://railway.app pe jao → login with GitHub
3. "New Project" → "Deploy from GitHub repo" → apna repo select karo
4. Railway apne aap Node.js detect karega, `npm install` + `npm start` chalayega
5. Deploy hone ke 1-2 min baad, "Settings" tab mein "Generate Domain" pe click karo
6. Milega ek public URL jaise: `https://desi-editor-production.up.railway.app`
7. Ye URL browser mein kholo — seedha Desi Editor app khul jayega (frontend + backend dono)

### Option B: Railway CLI se (bina GitHub ke)
```bash
npm i -g @railway/cli
cd backend
railway login
railway init
railway up
railway domain
```
Last command se public URL milega.

## Testing locally (optional pehle try karne ke liye)
```bash
cd backend
npm install
npm start
```
Browser mein `http://localhost:3000` kholo.

## Features
1. **Trim** - start/end time se video cut
2. **Filters** - grayscale, sepia, vintage, bright, contrast, blur, invert, cool, warm
3. **Text Overlay** - custom text, position, font size, color
4. **Music** - background music, mix ya replace mode
5. **Transitions** - fade/wipe/slide/circle/dissolve se 2 clips jodo

## Important Notes
- Railway free tier: 500 hours/month free, uske baad paid plan chahiye
- Video files `uploads/` aur `output/` folder mein store hoti hain — periodically clean karna padega (Railway restart pe bhi clear ho jati hain kyunki filesystem ephemeral hai)
- Bade videos process hone mein time lagega, FFmpeg CPU-heavy hai
- Aur features chahiye (crop, speed, stickers, subtitles) to bata dena
