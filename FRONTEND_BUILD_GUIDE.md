# BrainJot — Frontend Build Guide

Everything you need to build the website frontend against this backend.

---

## 1. Overview

BrainJot is a collaborative project & task management app. The backend is an Express.js + MongoDB API with session-based auth, real-time updates via Socket.IO, file uploads (local disk or Cloudflare R2), and email via Resend.

**Base API URL:** All API calls go to `/api` (e.g. `https://your-domain.com/api`)

**API pattern:** Almost all endpoints use a single URL with an `?action=` query param.
- `GET /api?action=<action>` — read operations
- `POST /api?action=<action>` — write operations

**Auth:** Cookie-based sessions. The browser sends cookies automatically. Always use `credentials: 'include'` in `fetch`.

---

## 2. Data Models

### User
```
{
  id: "user_xxxxxxxx"         // internal user ID
  email: string
  name: string
  username: string            // 3-20 chars, lowercase, letters/numbers/underscore only
  role: "user" | "superadmin"
  avatarUrl: string           // URL or empty string
  createdAt: Date
}
```

### Space
```
{
  id: "space_xxxxxxxx"
  title: string               // max 200 chars
  icon: string                // emoji, max 4 chars
  color: string               // hex color e.g. "#6366f1"
  description: string         // max 500 chars
  ownerId: string
  collaborators: Collaborator[]
  inviteToken: string
  inviteLinkRole: "editor" | "viewer"
  inviteTokenExpiry: Date
  __orderRank: number         // for ordering in sidebar
}
```

### Project
```
{
  id: "proj_xxxxxxxx"
  title: string               // max 200 chars
  subtitle: string            // max 300 chars
  color: string               // hex color
  tag: string                 // max 50 chars, e.g. "Project", "Design"
  spaceId: string             // which space it belongs to
  ownerId: string
  tasks: Task[]
  notes: string               // plain text notes (max 200KB)
  richNotes: string           // rich text / JSON (max 200KB)
  files: File[]
  collaborators: Collaborator[]
  labels: Label[]
  archived: boolean
  inviteToken: string
  inviteLinkRole: "editor" | "viewer"
  inviteTokenExpiry: Date
  __orderRank: number
}
```

### Task
```
{
  id: "task_xxxxxxxx"
  text: string                // max 500 chars
  done: boolean
  badge: string               // label ID or display name
  notes: string               // plain text (max 200KB)
  richNotes: string           // rich text / JSON (max 200KB)
  files: File[]
  deadline: string            // ISO string or ""
  assignee: string            // legacy, kept for compat
  assignees: string[]         // array of collaborator IDs or "me"
  priority: "urgent" | "important" | "later" | ""
  comments: Comment[]
  createdAt: Date
  finishedAt: Date | null
}
```

### Collaborator (on Project or Space)
```
{
  id: "collab_xxxxxxxx"
  userId: string              // links to User.id (empty if not yet registered)
  name: string
  username: string
  email: string
  role: "editor" | "viewer"
  status: "invited" | "active"
  avatarUrl: string
}
```

### File
```
{
  id: string
  name: string                // original filename
  file: string                // storage key
  url: string                 // public URL to serve/download
  type: string                // file extension e.g. "pdf", "jpg"
  size: number                // bytes
  uploaded: string            // "YYYY-MM-DD HH:mm"
}
```

### Label
```
{
  id: "lbl_xxxxxxxx"
  name: string                // max 30 chars
  color: string               // hex color
}
```

### Comment
```
{
  id: "cmt_xxxxxxxx"
  userId: string
  username: string
  name: string
  avatarUrl: string
  text: string                // max 1000 chars
  mentions: string[]          // array of usernames mentioned with @
  createdAt: Date
}
```

### Notification
```
{
  id: "notif_xxxxxxxx"
  toUserId: string
  fromUserId: string
  fromUsername: string
  fromName: string
  fromAvatarUrl: string
  type: "collab_invite" | "invite_response" | "task_assigned" | "task_comment" | "mention"
  meta: {
    entityId: string
    entityType: "project" | "space"
    entityTitle: string
    taskId?: string
    taskTitle?: string
    commentText?: string
    role?: string
    inviteToken?: string
    accepted?: boolean
  }
  status: "pending" | "accepted" | "denied" | "read"
  createdAt: Date
}
```

---

## 3. Authentication

### Check session (call on app load)
```
GET /api?action=check

Response:
{
  loggedIn: boolean,
  googleClientId: string | null,  // set if Google OAuth is configured
  features: { livekit: boolean }, // true if video/audio calls are available
  user?: {                        // only if loggedIn=true
    id, name, email, username, role, avatarUrl
  }
}
```

### Register with email/password
```
POST /api?action=register
Body: { email, password, name, username }

Validation:
- password: min 8 chars, must have uppercase + number
- username: 3-20 chars, lowercase letters/numbers/underscore only

Response: { ok: true, user: { id, name, email, username, role, avatarUrl } }
Errors: 400 (validation), 409 (email or username taken)
```

### Login with email/password
```
POST /api?action=login
Body: { email, password }

Response: { ok: true, user: { id, name, email, username, role, avatarUrl } }
Errors: 401 (wrong credentials)
```

### Google OAuth login
```
POST /api?action=google_auth
Body: { credential: "<Google ID token from Google Sign-In button>" }

Response: { ok: true, user: { id, name, email, username, role, avatarUrl } }
```
Use the Google Sign-In JS library to get the `credential` token, then send it here. Auto-registers new users.

### OTP login (passwordless)
Two-step flow:

**Step 1 — Send OTP**
```
POST /api?action=send_otp
Body: { email }

Response: { ok: true, exists: boolean }
// exists=true means the email already has an account
```

**Step 2a — Verify OTP (existing user)**
```
POST /api?action=verify_otp
Body: { email, otp }

Response:
{ ok: true, verified: true, exists: true, user: { ... } }  // logged in
{ ok: true, verified: true, exists: false }                 // no account, go to Step 2b
```

**Step 2b — Register via OTP (new user)**
```
POST /api?action=register_otp
Body: { email, name, username, otp }

Response: { ok: true, user: { id, name, email, username, role, avatarUrl } }
```

### Logout
```
POST /api?action=logout

Response: { ok: true }
```

### Check username availability
```
GET /api?action=check_username&username=<username>

Response: { available: boolean, error?: string }
```

---

## 4. Core Data — Spaces & Projects

### Fetch all data (main app load)
```
GET /api?action=get

Response:
{
  spaces: Space[],
  projects: Project[],
  sharedProjects: SharedProject[],  // projects where user is collaborator
  sharedSpaces: SharedSpace[],      // spaces where user is collaborator
}

// SharedProject adds: myRole ("editor"|"viewer"), ownerInfo: { userId, name, username, avatarUrl }
// SharedSpace adds: myRole, ownerInfo, projects: Project[]  (projects in that shared space)
```
This is your main data-fetch call. Call it once after login and after any mutation.

---

## 5. Spaces

### Create space
```
POST /api?action=add_space
Body: { title, icon?, color?, description? }
// color must be valid hex (#abc or #aabbcc)
// icon is emoji string

Response: { ok: true, id: "space_xxx" }
```

### Edit space
```
POST /api?action=rename_space
Body: { spaceId, title?, icon?, color?, description? }

Response: { ok: true }
```

### Delete space
```
POST /api?action=delete_space
Body: { spaceId }

Response: { ok: true }
// WARNING: deletes all projects and files inside the space
```

### Reorder spaces (drag & drop)
```
POST /api?action=reorder_spaces
Body: { order: ["space_1", "space_2", ...] }  // full ordered array of space IDs

Response: { ok: true }
```

---

## 6. Projects

### Create project
```
POST /api?action=add_project
Body: { title, subtitle?, color?, tag?, spaceId? }
// Limits: max 200 projects per user

Response: { ok: true, id: "proj_xxx" }
```

### Edit project
```
POST /api?action=rename_project
Body: { projectId, title, subtitle?, tag?, color? }

Response: { ok: true }
```

### Duplicate project (same space)
```
POST /api?action=duplicate_project
Body: { projectId }

Response: { ok: true, id: "proj_xxx" }  // new project ID
```

### Copy project to another space
```
POST /api?action=copy_project
Body: { projectId, spaceId }

Response: { ok: true, id: "proj_xxx" }
```

### Move project to another space
```
POST /api?action=move_project
Body: { projectId, spaceId }

Response: { ok: true }
```

### Archive / unarchive project
```
POST /api?action=archive_project
Body: { projectId }

POST /api?action=unarchive_project
Body: { projectId }

Response: { ok: true }
```

### Delete project
```
POST /api?action=delete_project
Body: { projectId }

Response: { ok: true }
// Deletes all tasks and files inside
```

### Clear all tasks in a project
```
POST /api?action=clear_project_tasks
Body: { projectId }

Response: { ok: true }
```

### Reorder projects
```
POST /api?action=reorder_projects
Body: { order: ["proj_1", "proj_2", ...] }

Response: { ok: true }
```

---

## 7. Tasks

### Add task
```
POST /api?action=add_task
Body: { projectId, text }
// Limits: max 1000 tasks per project

Response: { ok: true, id: "task_xxx" }
```

### Toggle task done/undone
```
POST /api?action=task_toggle
Body: { projectId, taskId }

Response: { ok: true }
// Also fires Socket.IO "project_updated" event to the project room
```

### Rename task
```
POST /api?action=rename_task
Body: { projectId, taskId, text }

Response: { ok: true }
```

### Update task metadata (deadline, assignees, priority, badge)
```
POST /api?action=update_task_meta
Body: {
  projectId,
  taskId,
  deadline?,   // ISO string or ""
  assignee?,   // legacy single assignee
  assignees?,  // array of collaborator IDs or "me"
  priority?,   // "urgent" | "important" | "later" | ""
  badge?,      // label ID or string name
}

Response: { ok: true }
// Notifies newly assigned collaborators via Notification system
```

### Delete task
```
POST /api?action=delete_task
Body: { projectId, taskId }

Response: { ok: true }
```

### Restore deleted task (undo)
```
POST /api?action=restore_task
Body: { projectId, task: { id, text, done, priority, deadline, badge, assignees } }

Response: { ok: true }
```

---

## 8. Notes

### Save project plain-text notes
```
POST /api?action=save_notes
Body: { projectId, notes }  // max 200KB

Response: { ok: true }
```

### Save project rich notes (editor JSON/HTML)
```
POST /api?action=save_project_rich_notes
Body: { projectId, notes }  // max 200KB

Response: { ok: true }
```

### Save task plain-text notes
```
POST /api?action=save_task_notes
Body: { projectId, taskId, notes }  // max 200KB

Response: { ok: true }
```

### Save task rich notes
```
POST /api?action=save_task_rich_notes
Body: { projectId, taskId, notes }  // max 200KB

Response: { ok: true }
```

---

## 9. Labels

Labels live inside each project and can be assigned to tasks via `badge`.

### Add label
```
POST /api?action=add_project_label
Body: { projectId, name, color? }  // name max 30 chars

Response: { ok: true, id: "lbl_xxx" }
```

### Edit label
```
POST /api?action=update_project_label
Body: { projectId, labelId, name?, color? }

Response: { ok: true }
```

### Delete label
```
POST /api?action=delete_project_label
Body: { projectId, labelId }

Response: { ok: true }
// Also clears badge from all tasks that used this label
```

---

## 10. File Uploads

The backend supports two upload modes. Check which mode is active first.

### Check upload mode
```
GET /api?action=get_upload_url&filename=x&type=project&projectId=proj_xxx

If disk mode: { ok: true, diskMode: true }
If R2 mode:   { ok: true, uploadUrl, fileKey, fileId }
```

### Mode A — Disk mode (local dev / no R2)

**Upload project file:**
```
POST /api?action=upload
Body: FormData with fields: file (the file), projectId

Response: { ok: true, file: File }
```

**Upload task file:**
```
POST /api?action=upload_task_file
Body: FormData with fields: file, projectId, taskId

Response: { ok: true, file: File }
```

**Upload avatar:**
```
POST /api?action=upload_avatar
Body: FormData with fields: file

Response: { ok: true, avatarUrl: string }
```

### Mode B — R2 mode (production)

**Step 1 — Get presigned URL**
```
GET /api?action=get_upload_url&filename=photo.jpg&mimeType=image/jpeg&size=12345&type=<type>&projectId=<id>&taskId=<id>

type values: "avatar" | "project" | "task"
projectId required for project/task, taskId required for task

Response: { ok: true, uploadUrl, fileKey, fileId }
```

**Step 2 — Browser uploads directly to R2**
```
PUT <uploadUrl>
Body: raw file binary
Headers: { "Content-Type": mimeType }
```

**Step 3 — Confirm to backend**
```
POST /api?action=confirm_upload
Body: { fileId, fileKey, filename, mimeType, size, type, projectId?, taskId? }

Response (project/task): { ok: true, file: File }
Response (avatar):       { ok: true, avatarUrl: string }
```

### File limits
- Avatar: max 2MB, formats: jpg/png/webp/gif
- All other files: max 50MB, formats: jpg/jpeg/png/gif/webp/pdf/doc/docx/xls/xlsx/ppt/pptx/mp4/mov/zip/txt/csv

### Delete project file
```
POST /api?action=delete_file
Body: { projectId, fileId }

Response: { ok: true }
```

### Delete task file
```
POST /api?action=delete_task_file
Body: { projectId, taskId, fileId }

Response: { ok: true }
```

### Download file
```
GET /api/download?url=<fileUrl>&name=<originalName>
// Requires auth. Redirects to R2 URL or serves from disk.
```

---

## 11. Collaboration

### Find users to invite
```
GET /api?action=find_user&q=<username_prefix>
// searches by username, returns up to 8 results, excludes self

Response: { users: [{ id, name, username, avatarUrl }] }
```

### Invite collaborator to project (by email)
```
POST /api?action=invite_collaborator
Body: { projectId, email, name?, role }  // role: "editor" | "viewer"

Response: { ok: true, collaborator: Collaborator }
// Sends invite email via Resend
```

### Invite collaborator to space (by email)
```
POST /api?action=invite_space_collaborator
Body: { spaceId, email, name?, role }

Response: { ok: true }
```

### Send collab invite (by email, with invite link token)
```
POST /api?action=send_collab_invite
Body: { email, entityId, entityType, role }
// entityType: "project" | "space"

Response:
{ ok: true, invitedName: string }            // user exists, notification sent
{ ok: true, notFound: true, invitedName: email }  // no account, email sent only
```

### Generate shareable invite link
```
POST /api?action=generate_invite_link
Body: { entityId, entityType, role }

Response: { ok: true, token: string }
// Build the link as: <APP_URL>?join=<token>
// Link expires in 7 days
```

### Join via invite link
```
POST /api?action=join_via_link
Body: { token }

Response:
{ ok: true, entityType, entityId, entityTitle, role }
{ ok: true, alreadyOwner: true, ... }
{ ok: true, alreadyMember: true, ... }
Errors: 403 if wrong email, 404 if invalid token, 410 if expired
```

### Update collaborator role
```
POST /api?action=update_collaborator_role
Body: { projectId, collaboratorId, role }

POST /api?action=update_space_collaborator_role
Body: { spaceId, collaboratorId, role }

Response: { ok: true }
```

### Remove collaborator
```
POST /api?action=remove_collaborator
Body: { projectId, collaboratorId }

POST /api?action=remove_space_collaborator
Body: { spaceId, collaboratorId }

Response: { ok: true }
```

---

## 12. Notifications

### Get notifications
```
GET /api?action=get_notifications

Response: { notifications: Notification[] }
// Returns last 50, sorted newest first
```

### Respond to collab invite notification
```
POST /api?action=respond_collab_invite
Body: { notifId, accept: boolean }

Response: { ok: true, accepted: boolean }
```

### Mark notification(s) read
```
POST /api?action=mark_notification_read
Body: { notifId? }  // omit notifId to mark all read

Response: { ok: true }
```

**Notification badge logic:**
- Show badge count for notifications where `status === "pending"` and `type !== "collab_invite"` — or pending collab invites the user hasn't responded to yet.
- Collab invites need a special UI (Accept / Decline buttons), not just a "read" dismiss.

---

## 13. Task Comments

### Get comments
```
GET /api?action=get_task_comments&projectId=<id>&taskId=<id>

Response: { comments: Comment[] }
```

### Add comment
```
POST /api?action=add_task_comment
Body: { projectId, taskId, text, mentions? }
// mentions: array of usernames mentioned with @, e.g. ["alice", "bob"]
// text max 1000 chars, max 500 comments per task

Response: { ok: true, comment: Comment }
// Sends notifications to @mentioned users and task assignees
```

---

## 14. User Profile

### Get profile stats
```
POST /api?action=get_profile_stats

Response:
{
  user: { name, email, username, role, avatarUrl, createdAt },
  stats: {
    projectCount, spaceCount,
    taskTotal, taskDone, taskOpen,
    completionRate,   // 0-100
    fileCount, feedbackCount
  }
}
```

### Update profile (name / email)
```
POST /api?action=update_profile
Body: { name?, email? }

Response: { ok: true, name?, email? }
```

### Set username (one-time, cannot change later)
```
POST /api?action=set_username
Body: { username }

Response: { ok: true, username }
Errors: 409 if already set
```

### Change password
```
POST /api?action=change_password
Body: { currentPassword, newPassword }
// Invalidates all other active sessions

Response: { ok: true }
```

### Delete account
```
POST /api?action=delete_account
Body: { password }
// Deletes all projects, spaces, files, and feedback

Response: { ok: true }
```

### Export data
```
POST /api?action=export_data
// Rate limited: 5 times per hour

Response: { spaces: Space[], projects: Project[], exportedAt: string }
```

---

## 15. Feedback

### Submit feedback
```
POST /api?action=post_feedback
Body: { message, type? }
// type: "bug" | "idea" | "general" (default: "general")
// message max 500 chars

Response: { ok: true, item: FeedbackItem }
```

### Get all feedback
```
GET /api?action=get_feedback

Response:
{
  items: [{
    id, userId?, userName, message, type, status,
    upvoteCount: number,
    hasUpvoted: boolean,
    createdAt
  }]
}
```

### Upvote / un-upvote feedback
```
POST /api?action=upvote_feedback
Body: { feedbackId }

Response: { ok: true, upvoteCount: number, hasUpvoted: boolean }
```

### Toggle feedback status (superadmin only)
```
POST /api?action=toggle_feedback_status
Body: { feedbackId }

Response: { ok: true, status: "open" | "fixed" }
```

---

## 16. Real-Time (Socket.IO)

The backend uses Socket.IO for live collaboration. Use the `socket.io-client` package.

```js
import { io } from 'socket.io-client'

const socket = io('/', { withCredentials: true })
```

### Join a room
```js
socket.emit('join_room', 'project:proj_xxx')   // or 'space:space_xxx'
socket.emit('leave_room', 'project:proj_xxx')
```

### Listen for project updates
```js
socket.on('project_updated', ({ projectId }) => {
  // Re-fetch the project data
})
```

### Call events (only if livekit feature is enabled)

**Start a call:**
```
GET /api?action=get_call_token&projectId=<id>&callType=audio|video
Response: { ok: true, token, roomName, livekitUrl }
// Use the LiveKit client SDK with token + livekitUrl
```

**Socket events for calls:**
```js
// Emitted to room members when a call starts
socket.on('call:started', ({ callId, entityType, hostUserId, hostName, callType }) => {})

// Emitted when call ends
socket.on('call:ended', ({ callId }) => {})

// Collaborator requests to join
socket.emit('call:join_request', { callId, requesterName })
socket.on('call:join_requested', ({ callId, requesterId, requesterName }) => {})

// Host accepts/rejects
socket.emit('call:accept_join', { callId, requesterId, requesterName })
socket.on('call:join_accepted', ({ callId, token, roomName, livekitUrl, callType }) => {})
socket.on('call:join_rejected', ({ callId }) => {})

// Invite a specific collaborator
socket.emit('call:invite', { callId, inviteeId })
socket.on('call:invited', ({ callId, hostName, callType, entityType }) => {})

// Host ends call for everyone
socket.emit('call:end', { callId })
```

---

## 17. Admin Panel (superadmin only)

All admin routes are at `/api/admin/*`. Requires `role === "superadmin"`.

| Method | Route | Description |
|--------|-------|-------------|
| GET | `/api/admin/stats` | Overview: user count, project count, task count, sessions, DB size |
| GET | `/api/admin/users` | List all users with project counts |
| POST | `/api/admin/users/grant` | Grant superadmin — body: `{ email }` |
| POST | `/api/admin/users/:id/revoke` | Revoke superadmin, force-logout user |
| DELETE | `/api/admin/users/:id` | Delete user and all their data |
| GET | `/api/admin/sessions` | List all active sessions |
| DELETE | `/api/admin/sessions/:id` | Force-logout a session |
| GET | `/api/admin/feedback` | All feedback (admin view, includes userId) |
| DELETE | `/api/admin/feedback/:id` | Delete a feedback item |
| GET | `/api/admin/system` | DB collection stats, env var health check |
| GET | `/api/admin/analytics` | Charts: user growth, task distribution, top users, space usage |

---

## 18. Health Check

```
GET /api/health

Response:
{
  status: "ok" | "degraded",
  version: string,    // git commit SHA (first 8 chars)
  uptime: number,     // seconds
  environment: string,
  checks: { db: "ok" | "connecting" | "down" }
}
```

---

## 19. Rate Limits

| Scope | Limit |
|-------|-------|
| Auth actions (login, register, OTP) | 20 per 15 min per IP |
| All authenticated API actions | 500 per 15 min per user |
| Export data | 5 per hour per user |

All rate limit errors return `429` with `{ error: "..." }`.

---

## 20. Error Responses

All errors follow the same shape:
```json
{ "error": "Human-readable message" }
```

| Status | Meaning |
|--------|---------|
| 400 | Bad request / validation failed |
| 401 | Not logged in |
| 403 | Logged in but not authorized |
| 404 | Resource not found |
| 409 | Conflict (duplicate email, username taken, etc.) |
| 410 | Gone (expired invite link) |
| 413 | Payload too large (notes > 200KB) |
| 429 | Rate limited or limit reached (project/task count) |
| 500 | Server error |

---

## 21. Key Frontend Patterns

### Fetch wrapper
```js
async function api(method, action, body) {
  const url = `/api?action=${action}`
  const res = await fetch(url, {
    method,
    credentials: 'include',
    headers: body instanceof FormData ? undefined : { 'Content-Type': 'application/json' },
    body: body instanceof FormData ? body : body ? JSON.stringify(body) : undefined,
  })
  const data = await res.json()
  if (!res.ok) throw new Error(data.error || 'Request failed')
  return data
}

// Usage
api('GET', 'check')
api('POST', 'login', { email, password })
api('POST', 'add_task', { projectId, text })
```

### App startup flow
1. `GET /api?action=check` → check if logged in
2. If not logged in → show login/register page
3. If logged in → `GET /api?action=get` → load all spaces + projects
4. Connect Socket.IO
5. Join rooms for projects/spaces the user is viewing

### Permissions
- **Owner**: full access to all operations
- **Editor**: can add/edit/delete tasks, add comments, upload files, add notes
- **Viewer**: read-only; cannot mutate tasks, notes, or files

Check `myRole` on shared projects/spaces. For owned items, the user is always owner.

### Invite link flow
1. Owner clicks "Share" → `POST generate_invite_link` → get `token`
2. Build URL: `https://yourapp.com?join=<token>`
3. New visitor opens URL → if not logged in, redirect to login/register, then back
4. After login → `POST join_via_link` with `{ token }`
5. Redirect to the project/space

---

## 22. Environment Variables (for reference)

| Variable | Required | Description |
|----------|----------|-------------|
| `MONGODB_URI` | Yes | MongoDB connection string |
| `SESSION_SECRET` | Yes | Secret for session signing |
| `PORT` | No | Server port (default 3001) |
| `NODE_ENV` | No | Set to "production" for secure cookies |
| `APP_URL` | No | Public app URL (used in invite email links) |
| `ADMIN_EMAILS` | No | Comma-separated emails auto-granted superadmin |
| `GOOGLE_CLIENT_ID` | No | Enables Google Sign-In |
| `RESEND_API_KEY` | No | Enables email (invites, OTP) |
| `FROM_EMAIL` | No | Sender address for emails |
| `R2_ACCOUNT_ID` | No | Cloudflare R2 — enables R2 uploads |
| `R2_ACCESS_KEY_ID` | No | Cloudflare R2 |
| `R2_SECRET_ACCESS_KEY` | No | Cloudflare R2 |
| `R2_BUCKET_NAME` | No | Cloudflare R2 |
| `R2_PUBLIC_URL` | No | Public URL prefix for R2 files |
| `LIVEKIT_API_KEY` | No | Enables audio/video calls |
| `LIVEKIT_API_SECRET` | No | LiveKit |
| `LIVEKIT_URL` | No | LiveKit server URL |
| `ALLOWED_ORIGINS` | No | Comma-separated CORS origins (default: localhost:5173) |
