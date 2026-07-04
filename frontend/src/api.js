import axios from 'axios';

const rawApiUrl = (import.meta.env.VITE_API_URL || import.meta.env.VITE_BACKEND_URL || '').trim();

function normalizeApiOrigin(url) {
  const clean = url.replace(/\/+$/, '');
  return clean.endsWith('/api') ? clean.slice(0, -4) : clean;
}

export const API_ORIGIN = normalizeApiOrigin(rawApiUrl);
export const API_BASE_URL = API_ORIGIN ? `${API_ORIGIN}/api` : '/api';

export function apiUrl(path = '') {
  if (/^https?:\/\//i.test(path)) return path;
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${API_ORIGIN}${normalizedPath}`;
}

const apiInstance = axios.create({
  baseURL: API_BASE_URL,
  withCredentials: true,
});

export async function api(action, body = null, method = 'POST', extraQuery = '') {
  try {
    const config = { method, url: `?action=${action}${extraQuery}` };
    if (body && method !== 'GET') {
      config.data = body;
    }
    if (import.meta.env.DEV) {
      const SENSITIVE = ['password', 'currentPassword', 'newPassword'];
      const safeBody = body && SENSITIVE.some(k => k in body)
        ? Object.fromEntries(Object.entries(body).map(([k, v]) => [k, SENSITIVE.includes(k) ? '***' : v]))
        : body;
      console.log(`[API CALL] ${method} ${action}`, safeBody);
    }
    const res = await apiInstance(config);
    return res.data;
  } catch (error) {
    if (error.response?.data) return error.response.data;
    throw error;
  }
}

export async function apiForm(action, fd) {
  try {
    if (import.meta.env.DEV) console.log(`[UPLOAD] ${action}`, [...fd.entries()].map(([k, v]) => `${k}=${v instanceof File ? v.name + '/' + v.type + '/' + v.size : v}`));
    const res = await fetch(apiUrl(`/api?action=${action}`), {
      method: 'POST',
      body: fd,
      credentials: 'include',
    });
    const data = await res.json();
    if (import.meta.env.DEV) console.log(`[UPLOAD RESULT] ${action}`, res.status, data);
    return data;
  } catch (error) {
    if (import.meta.env.DEV) console.error(`[UPLOAD ERROR] ${action}`, error);
    return { error: error.message || 'Network error' };
  }
}

// Push a fresh identity (new avatar, name) to the community app immediately by
// replaying its SSO exchange: mint a token here, post it to the community's
// sso-login. The community upserts its mirrored user AND backfills the avatar on
// the user's old posts/comments. Fire-and-forget: the community being down or
// the user never having opened it must not affect this app.
export async function syncCommunityIdentity() {
  try {
    const communityApi = (import.meta.env.VITE_COMMUNITY_API_URL || 'https://api.community.brainjot.space').replace(/\/+$/, '');
    const tokenRes = await apiInstance.get('/community/sso-token');
    const token = tokenRes.data?.token;
    if (!token) return;
    await fetch(`${communityApi}/api/auth/sso-login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ token }),
    });
  } catch { /* best-effort */ }
}

// Unified upload helper — uses presigned URL (browser→R2) when R2 is configured,
// falls back to server-side multipart (disk mode) otherwise.
// type: 'project' | 'task' | 'avatar'
export async function apiUpload(file, { type, projectId, taskId } = {}) {
  const qs = new URLSearchParams({ filename: file.name, mimeType: file.type, size: file.size, type });
  if (projectId) qs.set('projectId', projectId);
  if (taskId) qs.set('taskId', taskId);

  const urlRes = await api('get_upload_url', null, 'GET', '&' + qs.toString());
  if (urlRes.error) return urlRes;

  if (urlRes.diskMode) {
    // Disk mode: send file to server as multipart (existing flow)
    const fd = new FormData();
    fd.append('file', file);
    if (projectId) fd.append('projectId', projectId);
    if (taskId) fd.append('taskId', taskId);
    const action = type === 'avatar' ? 'upload_avatar' : type === 'task' ? 'upload_task_file' : 'upload';
    return apiForm(action, fd);
  }

  // R2 mode: upload directly from the browser to R2 via presigned URL
  if (import.meta.env.DEV) console.log('[UPLOAD] PUT to presigned URL', urlRes.uploadUrl);
  try {
    const putRes = await fetch(urlRes.uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': file.type },
      body: file,
    });
    if (!putRes.ok) {
      const msg = await putRes.text().catch(() => '');
      return { error: `Upload failed (${putRes.status}): ${msg.slice(0, 200)}` };
    }
  } catch (err) {
    if (import.meta.env.DEV) console.error('[UPLOAD] PUT error', err);
    return { error: err.message || 'Upload failed' };
  }

  // Confirm with server so it saves the file record to the database
  return api('confirm_upload', {
    fileId: urlRes.fileId,
    fileKey: urlRes.fileKey,
    filename: file.name,
    mimeType: file.type,
    size: file.size,
    type,
    projectId,
    taskId,
  });
}
