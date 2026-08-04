# Beacon Web

Production frontend for Beacon — the daily AI work desk.

## Stack

React · Vite · TypeScript · Tailwind v4 · Motion · React Query · React Hook Form · Zod · Lucide

## Run

```bash
npm install
npm run dev
```

`VITE_API_URL` defaults to the live Render API (`https://beacon-api-97gl.onrender.com`).

## Routes

- `/` — landing
- `/app` — single workspace job flow (choose → describe → quote → approve → live → result)

## Rules

- No mock jobs, quotes, balances, or receipts
- Consumer copy only (see `PRODUCT.md`)
- Dark mode only
