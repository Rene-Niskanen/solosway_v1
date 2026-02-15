# Setting up veloraview.com for development or production

Use this checklist so the app (and Word preview) works on your domain.

---

## Do we already have deployment set up?

**No.** The repo has Docker/docker-compose for **local** runs (Flask, Celery, Redis, etc.) and a `frontend-ts` Vite app you run with `npm run dev`. There were no configs for Vercel, Netlify, Railway, or Render. A **Vercel** config for the frontend has been added so you can deploy the UI with minimal setup.

---

## Cheapest way to launch

### Frontend (cheapest: free)

| Option | Cost | Notes |
|--------|------|--------|
| **Vercel** | Free tier | Recommended. Connect repo, set root to `frontend-ts`, add env vars. `frontend-ts/vercel.json` is already in the repo. |
| Netlify | Free tier | Connect repo, build command `npm run build`, publish directory `frontend-ts/dist`. |
| Cloudflare Pages | Free | Same idea: build from `frontend-ts`, output `dist`. |

**Steps for Vercel (free):**

1. Go to [vercel.com](https://vercel.com) and sign in (e.g. with GitHub).
2. **Add New Project** → import your repo.
3. Set **Root Directory** to `frontend-ts` (or deploy only the `frontend-ts` folder).
4. Vercel will detect Vite and use `vercel.json`; ensure **Build Command** is `npm run build` and **Output Directory** is `dist`.
5. Add **Environment Variables**: `VITE_BACKEND_URL` = your backend URL (e.g. `https://api.veloraview.com`), `VITE_MAPBOX_TOKEN` = your Mapbox token.
6. Deploy. You’ll get a URL like `your-app.vercel.app`. Optionally add your domain (e.g. `app.veloraview.com`) in Vercel’s project settings.

### Backend (cheapest options)

The backend is Flask + Celery + Redis (and uses Supabase, S3, etc.). There is **no** one-click backend deploy in the repo.

| Option | Cost | Notes |
|--------|------|--------|
| **Render** | Free tier (spins down when idle) | Deploy Flask as a Web Service. Add Redis via Render Redis (paid) or use **Upstash Redis** (free tier) and point Celery to it. |
| **Railway** | Free tier (limited hours) | Deploy Flask; add Redis plugin or external Redis. Good for trying things out. |
| **Fly.io** | Free allowance | Run a small VM; you can use Docker or run Flask + Redis + worker on one machine. |
| **VPS** (DigitalOcean, Hetzner, etc.) | ~$4–6/mo | One server: run `docker compose` (Flask, worker, Redis) or run processes directly. Full control. |

For a **minimal** cheap backend: use **Render** for the Flask API (free tier) and **Upstash Redis** (free) for Celery; run the Celery worker locally when you need it, or on a second free/cheap service. For “always on” and no spin-down, a small VPS is usually the cheapest single place to run API + worker + Redis.

---

## 1. DNS (at your domain registrar)

Point your domain (or subdomains) to where the app will run:

| Purpose      | Subdomain (example) | Points to                          |
|-------------|----------------------|------------------------------------|
| Frontend    | `app.veloraview.com` | Your frontend host (see step 2)    |
| Backend API | `api.veloraview.com` | Your backend host (see step 2)      |

- **A record**: `app.veloraview.com` → IP of your frontend server (if using a VPS).
- **CNAME**: `app.veloraview.com` → your hosting hostname (e.g. `yourapp.vercel.app`, or your server hostname).
- Same for `api.veloraview.com` to your backend host.

You can also use `veloraview.com` and `www.veloraview.com` for the frontend if you prefer; add those origins in backend CORS (see step 4).

---

## 2. Hosting (where the app runs)

**Frontend (React/Vite)**  
Deploy the `frontend-ts` build to one of:

- Vercel, Netlify, or Cloudflare Pages (connect repo, build command e.g. `npm run build`, output `dist`).
- Your own server: build with `npm run build`, serve the `dist` folder with nginx or similar.

**Backend (Flask)**  
Run the Flask API on a server that has a **public URL** (so Office Online can reach it for Word preview):

- Railway, Render, Fly.io, or a VPS (e.g. DigitalOcean, AWS EC2).
- Ensure the backend is reachable at `https://api.veloraview.com` (or whatever you chose).

**SSL (HTTPS)**  
Use HTTPS for both frontend and backend (required for Office Word preview in production). Your host often provides it (e.g. Let’s Encrypt); enable it for both app and api subdomains.

---

## 3. Environment variables

**Frontend (at build time or in host’s env)**  
In your frontend host (e.g. Vercel/Netlify env vars or `frontend-ts/.env.production`):

```env
VITE_BACKEND_URL=https://api.veloraview.com
VITE_MAPBOX_TOKEN=pk.your_mapbox_token_here
```

Use the **same** URL you use in the browser to call the API (no trailing slash). Rebuild/redeploy after changing.

**Backend (on the server or in your backend host)**  
Keep your existing backend env (Supabase, AWS, Redis, etc.). No change needed for the domain itself; the backend will see requests from `https://app.veloraview.com` and CORS will allow them (step 4).

---

## 4. CORS (backend)

This repo already allows these origins in `backend/config.py`:

- `https://veloraview.com`
- `https://www.veloraview.com`
- `https://app.veloraview.com`
- `https://dev.veloraview.com`

If you use a different frontend URL (e.g. `https://something.veloraview.com`), add it to `CORS_ORIGINS` in `backend/config.py`.

---

## 5. Cookies / auth (if you use session cookies)

If the frontend is on `https://app.veloraview.com` and the API on `https://api.veloraview.com`:

- Use `credentials: 'include'` on fetch (you already do).
- Backend should set cookies with `SameSite=None; Secure` (and allow your frontend origin in CORS) so the browser sends cookies cross-origin. If you use a different auth method (e.g. Bearer token), no change.

---

## 6. Quick check

1. Open `https://app.veloraview.com` (or your frontend URL).
2. Log in and open a Word document preview.
3. If the backend is on `https://api.veloraview.com`, Office Online can reach it and Word preview should load without the localhost warning.

If Word preview still shows an error, check:

- Backend is reachable: open `https://api.veloraview.com/health` (or any public GET) in a browser.
- The URL we send to Office is the one the backend returns (it uses the request host). So if the backend is behind a proxy, ensure the proxy passes the correct `Host` / `X-Forwarded-Host` so the generated link is `https://api.veloraview.com/...`.

---

## Summary

| Step | Action |
|------|--------|
| 1 | DNS: point `app.veloraview.com` and `api.veloraview.com` to your frontend and backend hosts. |
| 2 | Host frontend and backend with HTTPS. |
| 3 | Set `VITE_BACKEND_URL=https://api.veloraview.com` for the frontend and rebuild/redeploy. |
| 4 | CORS already includes veloraview.com; add any extra origins in `backend/config.py` if needed. |
| 5 | If using cookies, use `SameSite=None; Secure` and your frontend origin in CORS. |

After this, development or production on veloraview.com will work, and Word preview will work because Office can reach `https://api.veloraview.com`.
