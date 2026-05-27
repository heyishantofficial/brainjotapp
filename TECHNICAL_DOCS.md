# BrainJot Application - Technical Documentation

This document provides a comprehensive technical overview of the **BrainJot** project, detailing its architecture, database models, API routing strategy, authentication & authorization, and a complete reference of all available API endpoints.

---

## 1. Project Overview & Architecture

BrainJot is a full-stack web application designed for personal and professional project management. It allows users to organize their work into "Spaces" and "Projects," manage tasks, add rich notes, upload files, and assign mock collaborators.

**Tech Stack:**
*   **Frontend:** React (built with Vite), Tailwind CSS, Framer Motion for UI animations.
*   **Backend:** Node.js, Express.js.
*   **Database:** MongoDB (via Mongoose).
*   **Authentication:** Session-based (via `express-session`).
*   **File Storage:** Local disk storage (via `multer`).

**API Paradigm:**
Unlike standard RESTful APIs (which use different HTTP verbs and URL paths like `GET /projects/:id`), BrainJot implements an **Action-Based RPC (Remote Procedure Call)** style API. All requests go to the base `/api` endpoint, and the specific operation is determined by the `?action=` query parameter.

---

## 2. Authentication & Authorization

### Authentication Mechanism
BrainJot is currently designed as a **Single-Tenant (Single User)** system protected by a master password.
*   **Master Password:** Configured via the `APP_PASSWORD` environment variable (default: `ishant2026`).
*   **Session State:** Uses HTTP-only cookies and `express-session`. Once successfully logged in, the session `auth` property is set to the `APP_SECRET` string.
*   **Rate Limiting:** The `action=login` route is protected by `express-rate-limit` (max 100 requests per 15 minutes per IP) to prevent brute-force attacks.

### Authorization & "Roles"
Since this is a single-user system, **there is no real multi-user Role-Based Access Control (RBAC) enforced on the backend.** If you have the master password, you have full administrative access to everything.

However, the application implements **Mock Roles and Collaborators** at the data layer to support UI representations of teamwork:
*   **Space Collaborators:** Can be assigned a `role` (default is `editor`).
*   **Project Collaborators:** Have a `status` (e.g., `invited`).
*   **Task Assignees:** Tasks can be assigned to collaborators by their mock ID.
*   *Note:* These roles are strictly for display and organization. The backend does not restrict actions based on the collaborator ID.

---

## 3. Database Models (Mongoose Schemas)

The database consists of two primary models: **Spaces** and **Projects**. Projects encapsulate everything else (Tasks, Notes, Files).

### A. Space Model (`Space.js`)
Spaces act as top-level folders (e.g., "Work", "Personal").
*   `id`: String (Unique)
*   `title`: String
*   `icon`: String (Emoji, default '📁')
*   `color`: String (Hex)
*   `description`: String
*   `__orderRank`: Number (for UI reordering)
*   `collaborators`: Array of `SpaceCollaborator` (id, name, email, role)

### B. Project Model (`Project.js`)
Projects belong to a Space and contain all actionable items.
*   `id`: String (Unique)
*   `title`, `subtitle`, `color`, `tag`: Strings
*   `spaceId`: String (References Space `id`)
*   `notes` (Plain text) / `richNotes` (HTML text)
*   `archived`: Boolean
*   `__orderRank`: Number (for UI reordering)
*   `collaborators`: Array of `Collaborator` (id, name, email, status)
*   `files`: Array of `File` objects (id, name, file, url, type, size, uploaded)
*   `tasks`: Array of `Task` objects

### C. Task Sub-Schema (embedded in Project)
*   `id`, `text`: Strings
*   `done`: Boolean
*   `badge`: String (e.g., 'Custom', 'Urgent')
*   `notes`, `richNotes`: Strings
*   `files`: Array of `File` objects
*   `deadline`: String (Date representation)
*   `assignee` / `assignees`: Strings (References Collaborator IDs)
*   `priority`: String
*   `comments`: Array of objects (id, author, text, time)
*   `createdAt`, `finishedAt`: Dates

---

## 4. API Routes Reference

All routes are prefixed with `/api` and expect the `action` query parameter.

### GET Requests (`GET /api?action=...`)
| Action | Description | Auth Required |
| :--- | :--- | :--- |
| `check` | Checks if the current session is authenticated. | No |
| `get` | Returns all Spaces and Projects sorted by `__orderRank`. | Yes |
| **Download** | `GET /api/download?url=...&name=...` (Downloads an uploaded file). | Yes |

### POST Requests (`POST /api?action=...`)

#### Authentication
| Action | Body Parameters | Description |
| :--- | :--- | :--- |
| `login` | `password` | Authenticates the user and creates a session. |
| `logout` | (None) | Destroys the user's session. |

#### Spaces Management
| Action | Body Parameters | Description |
| :--- | :--- | :--- |
| `add_space` | `title`, `icon`, `color`, `description` | Creates a new space. |
| `rename_space` | `spaceId`, `title`, `icon`, `color`, `description` | Updates space details. |
| `delete_space` | `spaceId` | Deletes a space and cascades deletion to all its projects, tasks, and files. |
| `reorder_spaces` | `order` (Array of IDs) | Updates the `__orderRank` for UI sorting. |

#### Space Collaborators
| Action | Body Parameters | Description |
| :--- | :--- | :--- |
| `invite_space_collaborator` | `spaceId`, `email`, `name`, `role` | Adds a mock collaborator to a space. |
| `update_space_collaborator_role` | `spaceId`, `collaboratorId`, `role` | Updates the mock role of a space collaborator. |
| `remove_space_collaborator` | `spaceId`, `collaboratorId` | Removes a collaborator from a space. |

#### Project Management
| Action | Body Parameters | Description |
| :--- | :--- | :--- |
| `add_project` | `title`, `subtitle`, `color`, `tag`, `spaceId` | Creates a new project in a space. |
| `rename_project` | `projectId`, `title`, `subtitle`, `tag`, `color` | Updates project details. |
| `duplicate_project`| `projectId` | Deep-clones a project and its tasks (excluding files). |
| `delete_project` | `projectId` | Deletes a project and its associated files. |
| `archive_project` | `projectId` | Marks a project as archived. |
| `unarchive_project`| `projectId` | Restores an archived project. |
| `reorder_projects` | `order` (Array of IDs) | Updates the `__orderRank` for projects. |
| `clear_project_tasks`| `projectId` | Deletes all tasks within a project. |
| `save_notes` | `projectId`, `notes` | Saves plain text project notes. |
| `save_project_rich_notes` | `projectId`, `notes` | Saves rich HTML project notes. |

#### Project Collaborators
| Action | Body Parameters | Description |
| :--- | :--- | :--- |
| `invite_collaborator` | `projectId`, `email`, `name` | Adds a mock collaborator to a project. |
| `remove_collaborator` | `projectId`, `collaboratorId` | Removes a collaborator and unassigns them from tasks. |

#### Task Management
| Action | Body Parameters | Description |
| :--- | :--- | :--- |
| `add_task` | `projectId`, `text` | Creates a new task inside a project. |
| `rename_task` | `projectId`, `taskId`, `text` | Updates the text of a task. |
| `update_task_meta`| `projectId`, `taskId`, `deadline`, `assignee`, `assignees`, `priority`, `comments` | Updates task metadata. |
| `task_toggle` | `projectId`, `taskId` | Toggles the `done` boolean and updates `finishedAt`. |
| `delete_task` | `projectId`, `taskId` | Deletes a task and its files. |
| `restore_task` | `projectId`, `task` (Object) | Restores a previously deleted task. |
| `save_task_notes` | `projectId`, `taskId`, `notes` | Saves plain text task notes. |
| `save_task_rich_notes`| `projectId`, `taskId`, `notes` | Saves rich HTML task notes. |

#### File Management (Handled via `multer` middleware)
| Action | Body Parameters | Description |
| :--- | :--- | :--- |
| `upload` | `projectId`, `file` (Multipart form-data) | Uploads a file to a project. |
| `upload_task_file`| `projectId`, `taskId`, `file` (Multipart) | Uploads a file to a specific task. |
| `delete_file` | `projectId`, `fileId` | Deletes a project-level file from DB and disk. |
| `delete_task_file`| `projectId`, `taskId`, `fileId` | Deletes a task-level file from DB and disk. |
