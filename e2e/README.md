# Trading Academy — end-to-end walkthrough

`walkthrough.mjs` drives the whole product in Chromium (Playwright) the way a new user would:
guest start from the landing page → dashboard → search → asset page → charts → academy and labs →
paper trading (virtual money only) → AI teacher → replay → strategy builder → backtest → paper bot →
journal → analytics → settings → command palette and shortcuts help, then a mobile (390×844) pass.
Every page gets a real interaction. Selectors use roles and labels (`getByRole` / `getByLabel`).

## Run

1. Start the backend and the frontend (see the root README), e.g.

   ```bash
   # terminal 1 — API on :8000 with demo data
   cd backend && uvicorn app.main:app --port 8000
   # terminal 2 — UI on :3000 (dev or production build)
   cd frontend && npm run dev            # or a production build (see frontend/Dockerfile)
   ```

   Each run starts as a brand-new guest in a fresh browser context, so the database can be reused.

2. Run the walkthrough:

   ```bash
   cd e2e
   npm install                 # installs playwright
   npx playwright install chromium   # first time only
   npm run walkthrough
   ```

## Options (environment variables)

| Variable       | Default                 | Meaning                                         |
| -------------- | ----------------------- | ----------------------------------------------- |
| `BASE_URL`     | `http://localhost:3000` | Frontend URL (the `/api` proxy must reach the backend) |
| `SHOTS_DIR`    | `./shots`               | Screenshot folder (git-ignored)                 |
| `HEADLESS`     | `true`                  | `HEADLESS=0` shows the browser                  |
| `STEP_TIMEOUT` | `20000`                 | Default wait per action, in ms                  |

Example: `BASE_URL=http://127.0.0.1:3301 HEADLESS=0 npm run walkthrough`.

`playwright` is loaded with `require()`, so an existing install can be reused with `NODE_PATH`
(`NODE_PATH=/path/to/node_modules node walkthrough.mjs`) instead of `npm install`.

## Output

- One line per step: `OK   <step>` or `FAIL <step> <reason>`.
- A screenshot per step in `SHOTS_DIR` (`NN-<step>.png`). A failed step also writes `FAIL-<step>.png` and
  `FAIL-<step>.aria.txt` (the page's accessibility tree, handy for fixing selectors).
- At the end: unexpected console errors, page errors and failed `/api` responses (status ≥ 500, or any
  4xx except the expected `401` session probe before the guest login).
- Exit code `0` only when every step passed and no unexpected error was collected.

Everything the walkthrough does is paper trading with virtual funds; no real orders exist in the product.
