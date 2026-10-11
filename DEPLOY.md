# Putting LLMVibeCheck online

**Where each part runs:**

| Part | Where it runs | Cost |
|---|---|---|
| Frontend (the website) | Vercel | free |
| Backend (API) | Render, smallest paid plan (0.5 CPU / 512 MB), always on | Render shows the monthly price before you confirm |
| Database | TigerData cloud | free tier |

Allow about 30 minutes. Work through the steps in order; each step ends with what you should see.

> **Use your phone hotspot for step 3.** Venue Wi-Fi blocked TigerData's port earlier. The other steps work on any network.

---

## 1. Make a spending-limited OpenRouter key (5 min)

Anyone with your app's link can start runs, so give the hosted app its own key with a cap.

1. Go to **openrouter.ai → Settings → Keys → Create key**.
2. Name it `llmvibecheck-hosted` and set a **credit limit**, e.g. **$10**.
3. Copy the key (it starts with `sk-or-`). You'll paste it into Render in step 4.

ElevenLabs is optional. If you want voice steps online, create a separate key on elevenlabs.io with a low usage limit. Otherwise leave it out; voice steps will show an error and everything else still works.

✅ **You should see:** a new key in OpenRouter's list showing your limit.

---

## 2. Put the code on GitHub (5 min)

Your project has commits but no GitHub remote yet.

1. On github.com click **New repository** and name it `llmvibecheck`. Make it **Private**, and don't add a README.
2. In Terminal:
   ```bash
   cd ~/Documents/Projects/SquadVibeCheck
   git add -A && git commit -m "Hosting: Dockerfile, render.yaml, bundled fonts, copy script"
   git remote add origin https://github.com/<your-username>/llmvibecheck.git
   git push -u origin main        # your branch is called main
   ```
3. Check that **`.env` is NOT in the repo on GitHub**. It's in `.gitignore`, so it shouldn't be. If you ever see it there, rotate every key in it immediately.

✅ **You should see:** the repo on GitHub with `backend/`, `frontend/`, `render.yaml` and `DEPLOY.md`, and no `.env`.

---

## 3. Create the cloud database and copy tonight's data (10 min, on your hotspot)

1. Open **console.cloud.timescale.com** (TigerData). Use your existing service if it's **empty**, or create a new free one.
2. Copy its connection string. It looks like:
   `postgres://tsdbadmin:<password>@<id>.tsdb.cloud.timescale.com:<port>/tsdb?sslmode=require`
3. Make sure your local database is running (`docker start squad-db`), then from the `backend` folder:
   ```bash
   source .venv/bin/activate
   python scripts/copy_data.py --to "<TigerData connection string>" --dry-run
   ```
   This only counts rows and changes nothing. You should see your local counts, e.g. `runs 12`.
4. Run the real copy:
   ```bash
   python scripts/copy_data.py --to "<TigerData connection string>"
   ```

✅ **You should see:** a table where every row has the same number in `source` and `target`, then **"All rows copied."**

The script creates the tables itself, never deletes anything, and refuses to copy twice into the same database, so a re-run can't create duplicates.

---

## 4. Deploy the backend on Render (10 min)

1. On **dashboard.render.com** choose **New → Blueprint**, connect GitHub and pick the `llmvibecheck` repo. Render reads `render.yaml` and proposes a service called **llmvibecheck-api** on the smallest paid plan (0.5 CPU / 512 MB). Check the price it shows before you confirm.
2. It asks for the secret values. Paste:

   | Setting | Value |
   |---|---|
   | `OPENROUTER_API_KEY` | the **limited** key from step 1 |
   | `ELEVENLABS_API_KEY` | your limited ElevenLabs key, or leave blank |
   | `DATABASE_URL` | the TigerData connection string from step 3 |
   | `ALLOWED_ORIGINS` | `http://localhost:3000` for now; you'll add the Vercel address in step 6 |

3. Click **Apply**. The first build takes 3–5 minutes.
4. Copy the service address, e.g. `https://llmvibecheck-api.onrender.com`.

✅ **You should see:** opening `https://llmvibecheck-api.onrender.com/health` in a browser shows `{"status":"ok","db":"ok"}`.

If it says `"degraded"`, the database URL is wrong: re-paste it under **Environment** and Render redeploys.

> Keep the service at **1 instance**. Live runs, approval steps and progress streams are held in that one server's memory.

---

## 5. Deploy the frontend on Vercel (5 min)

1. On **vercel.com** choose **Add New → Project** and import the `llmvibecheck` repo.
2. Set **Root Directory** to `frontend`. Vercel detects Next.js automatically.
3. Under **Environment Variables**, add
   `NEXT_PUBLIC_API_URL` = `https://llmvibecheck-api.onrender.com` (your Render address, with no trailing slash).
4. Click **Deploy** (about 2 minutes). Copy your site address, e.g. `https://llmvibecheck.vercel.app`.

✅ **You should see:** the LLMVibeCheck home page loads. The lists may stay empty until step 6.

---

## 6. Let the website talk to the backend (2 min)

1. In Render, open **llmvibecheck-api → Environment** and set
   `ALLOWED_ORIGINS` = `https://llmvibecheck.vercel.app,http://localhost:3000`
   (use your real Vercel address, comma-separated, no spaces or trailing slashes).
2. Save. Render restarts the service (about 1 minute).

✅ **You should see:** on your Vercel site, Home shows your squads, tasks and runs from tonight, and Compare shows the Expression evaluator leaderboard.

---

## 7. Final check before the demo (5 min, about $0.03)

1. Open **Build**, load **Solo · GPT-5.4**, pick **Expression evaluator** and choose **Run squad**. The boxes should light up and finish in about 15 seconds.
2. Choose **Judge this run**. Three judge cards appear on the Evaluation tab.
3. Open **Compare**. The new run appears.

✅ If all three work, you're live.

---

## If something goes wrong

| Symptom | Fix |
|---|---|
| Home says "The backend isn't reachable" | Check the Render service is **Live**, and that `NEXT_PUBLIC_API_URL` on Vercel matches the Render address exactly. Redeploy Vercel after changing it. |
| Browser console shows a **CORS** error | `ALLOWED_ORIGINS` on Render must contain the exact Vercel address (`https://`, no trailing `/`). |
| `/health` shows `"db": "unreachable"` | Wrong `DATABASE_URL`, or the TigerData service is paused. Resume it in the TigerData console. |
| Runs fail with "out of OpenRouter credits" | The limited key reached its cap. Raise the limit in OpenRouter. |
| The copy script times out | You're on venue Wi-Fi. Switch to your hotspot. |
| Vercel preview links are blocked | Optionally set `ALLOWED_ORIGIN_REGEX` = `https://llmvibecheck-.*\.vercel\.app` on Render. |

**Good to know:**
- Voice files are stored on the Render server's disk and are cleared on each redeploy. Text results live in the database and are permanent.
- New pushes to `main` redeploy both Vercel and Render automatically.
