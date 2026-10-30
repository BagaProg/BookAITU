# Neon database

Project: `BookAITU` (`dry-boat-30055533`), AWS Frankfurt, PostgreSQL 18.

The current local database was copied to Neon on 2026-10-30. All public tables, constraints, indexes and sequences were restored. Active auth sessions were excluded so users must sign in again. Counts and checksums of all other public tables matched after restore.

`backend/.env` contains the active database connection. Its previous local configuration is saved in `backend/.env.local-before-neon`. Both are ignored by Git. Keep the existing AUTH_ENCRYPTION_KEY: imported 2FA secrets require it.

For Render, securely copy DATABASE_URL and the existing authentication secrets into the service environment. Never put database credentials in VITE variables. Microsoft redirect URL and FRONTEND_ORIGIN must match the published URLs.

The private `backend/.env.neon` file holds NEON_DATABASE_URL, a direct connection for administrative operations. The fresh dump and verification manifest are in ignored `database/backups/`.

`src/transferToNeon.cjs --export` creates a fresh local dump excluding session data. `--import` restores into an empty Neon database in one transaction and verifies checksums. It refuses a populated destination. The export requires the source DATABASE_URL in backend/.env to point to localhost. Do not run it after switching that file to Neon unless you deliberately restore the local configuration first.

The older db:migrate script is for local Windows PostgreSQL and must not be used as a Render startup command. Existing migrations have already been transferred.
