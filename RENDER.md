# Render deployment

Deploy the repository as one Node web service using `render.yaml` (Frankfurt, free plan). The service serves React and `/api` from one HTTPS origin. Database: existing Neon BookAITU; do not create or reset a database during deployment.

Build command: `npm run render:build`. Start command: `npm start`. Health check: `/healthz`. Set the repository root as the service root.

## Environment variables

Run `node backend/src/prepareRenderEnv.cjs` to generate a private `backend/.env.render` import file from the current backend configuration. Import its values using Render's Environment settings or the connected Render integration. Never commit or share this file. The existing encryption key must be preserved because the database contains encrypted 2FA secrets.

Do not upload `.env`, `.env.neon`, `.env.render`, local backups or database dumps to the repository. `.env.example` files contain templates only. `render.yaml` declares secret variables with `sync: false`.

Keep `VITE_API_URL` empty so the production frontend uses the same service origin. Render automatically provides `RENDER_EXTERNAL_URL`; backend derives FRONTEND_ORIGIN and MICROSOFT_REDIRECT_URI from it. Do not import localhost FRONTEND_ORIGIN, MICROSOFT_REDIRECT_URI or PORT from the development file. If using a custom domain later, explicitly set the HTTPS frontend origin and matching Microsoft callback.

After Render assigns its public URL, add `<public-url>/api/auth/microsoft/callback` as a Web redirect URI in the existing Microsoft Entra app registration. Retain local redirect URIs if local development is still needed. Real Microsoft sign-in and 2FA require an interactive user verification after deployment.

## Verification

Check `/healthz`, the home page, built assets, `/api/auth/session`, Microsoft sign-in, 2FA, rooms and booking operations. Anonymous requests to protected API routes must return 401. `.env` requests must return 404. Do not run the historical local Windows migration script on Render.
