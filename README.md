# Prospector

Prospector finds local business Instagram profiles and websites using Google Boolean searches through SerpApi.

## Runtime

- Frontend: static HTML/CSS/JS.
- Backend: Vercel Serverless Functions in `api/`.
- Required secret: `SERPAPI_API_KEY`.
- Optional secret: `GROQ_API_KEY`.
- Persistent duplicate protection: configure either Vercel KV (`KV_REST_API_URL`, `KV_REST_API_TOKEN`) or Postgres (`POSTGRES_URL` / `DATABASE_URL`).

Without KV or Postgres, local development stores leads in `.data/prospector.json`. Vercel serverless file storage is not durable, so production needs KV or Postgres for "no duplicates in the next run".

## Deploy path

`vercel.json` rewrites `/prospector`, `/prospector/assets/*`, and `/prospector/api/*` so the app can be opened at:

https://theclosinggap.net/prospector

