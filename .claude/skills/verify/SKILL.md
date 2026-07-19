---
name: verify
description: Build/launch/drive recipe for verifying brainjotapp changes locally (backend API + frontend build).
---

# Verifying brainjotapp changes

## Backend (Express + MongoDB, the main surface)

A local mongod usually runs already (`pgrep -lf mongod`). Use an isolated DB so real local data stays clean:

```bash
cd backend
MONGODB_URI="mongodb://127.0.0.1:27017/brainjot_verify" PORT=3101 \
  SESSION_SECRET="verify-session-secret-0123456789abcdef" node server.js
```

- No `.env` exists locally; R2/LiveKit/Resend warnings at startup are harmless (features degrade gracefully).
- `NODE_ENV` unset → cookies are `sameSite: lax`, plain http works.
- Everything is one endpoint: `POST/GET /api?action=<name>` with a JSON body. Session cookie auth (use curl cookie jars).

## Seeding users

`register` is dead (410) and OTP signup needs Resend. Seed users directly with the backend's own modules
(`node_modules/bcrypt`, `models/User`): required fields are `id, email, name, username, passwordHash`.
Then `POST /api?action=login {email, password}` for a session cookie.

## Useful flows

- Owner: `add_space {title,color}`, `add_project {title,subtitle,color,tag,spaceId}`,
  `generate_invite_link {entityId, entityType: project|space, role}` → token.
- Collaborator: `join_via_link {token}` — the real membership path (adds userId-linked collaborator entry).
- `get` returns `projects/spaces/sharedProjects/sharedSpaces` (shared ones annotated with `myRole`, `ownerInfo`).
- `get_notifications` for notification assertions.
- Task assignment: `add_task {projectId,text}` then `update_task_meta {projectId,taskId,assignees:[collabEntryId]}`
  (assignees are collaborator-entry ids, not userIds).

Kill the server and drop `brainjot_verify` when done.

## Frontend

`cd frontend && npm run build` (Vite, ~1s) catches JSX/wiring errors. `npx eslint <files>` — note there are
pre-existing unused-import errors in App.jsx/ProjectDetailView.jsx; don't chase them. No Playwright setup exists,
so UI clicks aren't drivable headlessly yet — verify logic at the API surface and rely on build for the UI layer.
