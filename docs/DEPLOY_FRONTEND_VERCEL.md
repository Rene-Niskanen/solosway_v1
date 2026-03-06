# Deploy the Velora frontend to Vercel

Step-by-step guide to host the **frontend** (React/Vite app) on Vercel. The **backend** (Flask API) must be hosted elsewhere (Render, Railway, Fly.io, or a VPS)—see [SETUP_VELORAVIEW_DOMAIN.md](./SETUP_VELORAVIEW_DOMAIN.md) for backend options.

---

## What you need before starting

1. **Code on GitHub**  
   This repo should be pushed to a GitHub (or GitLab/Bitbucket) account so Vercel can import it.

2. **A Vercel account**  
   Sign up at [vercel.com](https://vercel.com) (free; you can use “Continue with GitHub”).

3. **Backend URL (for production)**  
   The frontend calls the API via `VITE_BACKEND_URL`. For production you need a live backend, e.g.:
   - `https://api.veloraview.com` (once you point that domain to your backend), or  
   - A temporary URL from Render/Railway (e.g. `https://your-app.onrender.com`) for testing.

4. **Mapbox token**  
   Required for maps. Get one at [mapbox.com](https://www.mapbox.com/) and use the **public** token (starts with `pk.`).

5. **(Optional) Google sign-in**  
   If you want “Sign in with Google” on the deployed app, you need a Google OAuth Client ID and to add your Vercel URL (and/or `https://app.veloraview.com`) to “Authorized JavaScript origins” in Google Cloud Console.

---

## Step 1: Import the project in Vercel

1. Go to [vercel.com](https://vercel.com) and sign in.
2. Click **Add New…** → **Project** (or **Import Project**).
3. **Import Git Repository**: choose your GitHub account and select the `solosway_v1` repo (or whatever you named it).  
   - If the repo doesn’t appear, click **Configure GitHub App** and grant Vercel access to the repo.
4. Click **Import**.

---

## Step 2: Configure the project

Vercel will show “Configure Project”:

| Setting | Value | Why |
|--------|--------|-----|
| **Framework Preset** | Vite (should auto-detect) | Matches `frontend-ts` |
| **Root Directory** | **Edit** → set to `frontend-ts` | All app code lives in `frontend-ts` |
| **Build Command** | `npm run build` (default) | Same as in `vercel.json` |
| **Output Directory** | `dist` (default) | Vite builds to `dist` |
| **Install Command** | `npm install` (default) | — |

**Important:** After changing **Root Directory** to `frontend-ts`, Vercel will run all commands from that folder, so build/output paths are correct.

---

## Step 3: Add environment variables

In the same “Configure Project” screen, open **Environment Variables** and add:

| Name | Value | Environment | Required |
|------|--------|--------------|----------|
| `VITE_BACKEND_URL` | Your backend URL, e.g. `https://api.veloraview.com` or `https://your-app.onrender.com` | Production (and Preview if you want) | Yes |
| `VITE_MAPBOX_TOKEN` | Your Mapbox public token (e.g. `pk.eyJ1...`) | Production (and Preview if you use maps there) | Yes |
| `VITE_GOOGLE_CLIENT_ID` | Your Google OAuth 2.0 Client ID | Production / Preview (only if you use Google sign-in) | No |

- **No quotes** around values.
- **No trailing slash** on `VITE_BACKEND_URL`.
- For **Environment**, choose at least **Production**. Add **Preview** if you want preview deployments to talk to the same (or a separate) backend.

Then click **Deploy**. The first build may take 1–2 minutes.

---

## Step 4: Get your live URL

When the build finishes:

- Your app is live at **`https://<your-project>.vercel.app`**.
- You can open it and test login, maps, and API calls (as long as the backend is reachable and CORS allows your Vercel origin).

---

## Step 5: Add a custom domain (e.g. app.veloraview.com)

1. In Vercel, open your project → **Settings** → **Domains**.
2. Click **Add** and enter e.g. **`app.veloraview.com`**.
3. Vercel will show DNS instructions. At your domain registrar (where you bought veloraview.com):
   - Add a **CNAME** record:  
     **Name/host:** `app`  
     **Value/target:** `cname.vercel-dns.com`  
     (or the exact value Vercel shows).
4. Wait for DNS to propagate (minutes to a few hours). Vercel will issue an SSL certificate automatically.

After that, the app is available at **`https://app.veloraview.com`**.

**Backend CORS:** Your backend must allow the frontend origin. This repo’s `backend/config.py` already includes `https://app.veloraview.com`. If you test with the default Vercel URL (e.g. `https://your-project.vercel.app`) before adding a custom domain, add that exact URL to `CORS_ORIGINS` in `backend/config.py`, or the browser will block API requests. After you use a custom domain, that domain is already in CORS.

---

## Step 6: Redeploy when you change env vars

Environment variables are baked in at **build** time. If you add or change `VITE_*` variables:

1. Project → **Settings** → **Environment Variables** → edit or add.
2. Go to **Deployments** → open the latest deployment → **⋯** → **Redeploy** (or push a new commit to trigger a new build).

---

## Checklist summary

- [ ] Repo is on GitHub (or supported Git host).
- [ ] Vercel project created and **Root Directory** set to `frontend-ts`.
- [ ] `VITE_BACKEND_URL` set to your live backend URL (no trailing slash).
- [ ] `VITE_MAPBOX_TOKEN` set (Mapbox public token).
- [ ] (Optional) `VITE_GOOGLE_CLIENT_ID` set and Google Console has your Vercel/domain in Authorized JavaScript origins.
- [ ] Backend is deployed and reachable; CORS allows your Vercel URL and/or `https://app.veloraview.com`.
- [ ] (Optional) Custom domain added in Vercel and CNAME set at registrar.

---

## Troubleshooting

| Issue | What to check |
|-------|----------------|
| Build fails | Confirm **Root Directory** is `frontend-ts`. Check build logs for missing deps or errors. |
| “Failed to fetch” / API errors | Backend URL correct? Backend running? CORS includes your Vercel origin (e.g. `https://your-app.vercel.app`) or custom domain? |
| Maps don’t load | `VITE_MAPBOX_TOKEN` set and valid; redeploy after adding it. |
| Google sign-in fails | Add the exact origin (e.g. `https://app.veloraview.com`) to “Authorized JavaScript origins” in Google Cloud Console; no trailing slash. |
| 404 on refresh / deep links | `vercel.json` in `frontend-ts` already has rewrites to `/index.html`; if you changed routing, ensure all routes fall back to `index.html`. |

For full production setup (backend, DNS, cookies, Word preview), see [SETUP_VELORAVIEW_DOMAIN.md](./SETUP_VELORAVIEW_DOMAIN.md).
