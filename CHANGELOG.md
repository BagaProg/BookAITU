# Versions

## 1.0.0 — preserved baseline

Git tag: v1.0.0. Commit: 366af307454c6e7e4062518a42dead79807a327d.
Previous working version before timetable coverage changes. This tag preserves application source; it does not reverse database migrations.

## 1.0.1 — filters, audit and layout repairs

- Search preserves the chosen availability filter; partial timetable rooms remain visible by default.
- Location filters have one consistent control; long availability labels use a dropdown.
- Schedule and access-rule writes include audit records in the same transaction.
- Responsive schedule forms, room code selection, separate access editor and visible save feedback.
- Blue/teal accents, contained text and responsive controls.

Validation: 54 backend tests; PostgreSQL integration with temporary tables and full rollback; browser fixture checks at 1366, 768 and 390 pixels; frontend build. Browser fixtures do not replace live Microsoft/2FA sign-in testing.
