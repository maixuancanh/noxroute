# Vercel production deployment - 2026-08-02

Production URL: <https://noxroute.vercel.app>

Deployment:

- Vercel project: `noxroute`
- Deployment ID: `dpl_AKMNaG4NJa3ydF8aGUeYBYQvnVDo`
- Production deployment URL: `https://noxroute-l37omrri4-vancongabc955-5514s-projects.vercel.app`
- Stable production alias: `https://noxroute.vercel.app`
- Vercel team-scoped alias: `https://noxroute-vancongabc955-5514s-projects.vercel.app`
- Ready state: `READY`
- Vercel SSO deployment protection: disabled for public judge access

Static smoke checks:

- `/` returned `200`, `text/html`, and contains `NoxRoute`.
- `/app.js?v=chainlink-rate-1` returned `200`, `application/javascript`.
- `/v3-deployment.json` returned `200`, `application/json`.
- `/assets/weth-token.png` returned `200`, `image/png`.
- `/assets/usdc-token.png` returned `200`, `image/png`.

Browser smoke check:

- Opened the public URL in headless Chromium.
- Home page title: `NoxRoute - Private Strategy Router on Uniswap`.
- Home headline rendered.
- Trade route rendered `Nox encrypted strategy -> Uniswap V3`.
- How it works route rendered `Why Nox belongs inside a swap flow.`
- No page errors or console errors were captured.
