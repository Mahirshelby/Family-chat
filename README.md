# Family Chat

A private group chat website for one family (5–10 people). Open a link, enter your name and the family invite code, and chat.

- Text, photos and voice messages (up to 60 seconds)
- Big, simple interface with A− / A+ buttons to change the text size
- Bangla by default, English with one tap
- Vite + vanilla JS + Firebase (Auth + Firestore). No Firebase Storage, so no billing is needed.

## 1. Firebase setup (once)

1. Go to https://console.firebase.google.com and create a project.
2. **Build → Authentication → Get started → Sign-in method → Anonymous → Enable.**
3. **Build → Firestore Database → Create database.** Pick production mode and a nearby region (for Bangladesh, `asia-south1` Mumbai is a good choice).
4. In Firestore, open the **Rules** tab, paste the contents of `firestore.rules`, and click **Publish**.
5. Create the invite code. In the **Data** tab: **Start collection** → Collection ID `config` → Document ID `family` → add a field `inviteCode` (string) with your secret code, for example `mama2026`.
6. **Project settings (gear icon) → Your apps → Web (`</>`)** → register an app and copy the config values.

## 2. Run it on your computer (PowerShell)

```powershell
cd family-chat
Copy-Item .env.example .env
notepad .env        # paste the 4 Firebase values, save
npm install
npm run dev
```

Open the link Vite prints (usually http://localhost:5173), join with a name and your invite code.

## 3. Put it online with Render

1. Push the project to a GitHub repo.
2. On https://render.com: **New → Static Site** → pick the repo.
3. Settings:
   - Build Command: `npm install && npm run build`
   - Publish Directory: `dist`
   - Environment variables: add the same 4 `VITE_FIREBASE_*` values from your `.env`
4. Deploy. Render gives you a link like `https://family-chat-xxxx.onrender.com`.
5. **Important:** in Firebase go to **Authentication → Settings → Authorized domains → Add domain** and add your `onrender.com` domain (without `https://`). Without this, sign-in fails on the live site.

Share the Render link and the invite code with the family. That's it.

## Good to know

- To change the invite code, edit `inviteCode` in `config/family`. People who already joined stay in.
- Each phone/browser is one identity. If someone clears their browser data, they just join again with the code.
- Photos are shrunk automatically and voice messages are recorded at a low bitrate so they fit inside Firestore. The latest 60 messages are shown.
- Any member can delete their own messages (for everyone). Messages can't be edited.
- Firebase's free plan is far more than 10 people will use (50k reads and 20k writes per day).
- No push notifications yet. The page title shows "● New message" when a message arrives while the tab is in the background.
