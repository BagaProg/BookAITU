# Connected frontend

The working UI is `frontend`. It uses the existing backend with the existing database and authentication. A read-only room availability endpoint supports the finder.

From the repository root:

```sh
npm --prefix frontend install
npm run dev
```

Start the backend separately with `npm start --prefix backend` using its existing configuration. Frontend: http://localhost:5173. Default API: http://localhost:3101. To override the API, copy `.env.example` to `.env` and set `VITE_API_URL`. The frontend origin must match the backend authentication/CORS configuration. Port 5173 is strict so Vite cannot silently break the OAuth callback by choosing another port.

Microsoft login, TOTP enrollment/verification, recovery codes and admin dashboard are carried over from `frontend`. Admins can open `/admin` after signing in. The previous frontend has been removed.

The finder uses `GET /api/rooms/availability?date=YYYY-MM-DD&start=HH:mm&end=HH:mm`; room details use `GET /api/rooms`. Room IDs, blocks, floors, types and capacities come from the backend. Booking review sends `POST /api/bookings`; cancellation sends `DELETE /api/bookings/:id`. All API requests include session cookies and mutations include the CSRF token returned by authentication. A 401 returns the UI to authentication.

Availability is read from reservations across all users for the selected interval; disabled rooms are marked unavailable. Cancelled bookings and adjacent non-overlapping intervals do not block a room. The endpoint exposes room statuses, not other users’ booking details. Availability is checked again atomically on creation; a 409 shows a conflict message. University class schedules are not connected. Card photos illustrate AITU spaces and are not mapped to individual room IDs. Restart the backend after updating to enable the new endpoint. My bookings displays the API's latest 50 entries; for admins that limit applies across all users before filtering their own entries. Use the existing admin search for older records.

Checks:

```sh
npm run build
npm test --prefix frontend
npm test --prefix backend
```

Live Microsoft login still needs manual verification with a university account. No authentication bypass or test account was added.

Project layout: application code is in `frontend/src`, static assets in `frontend/public`, API client checks in `frontend/test`. The obsolete root demo has been removed; use the root npm scripts or run Vite from `frontend`.
