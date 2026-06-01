import axios from 'axios';

const apiInstance = axios.create({
  baseURL: '/api',
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
    const res = await fetch(`/api?action=${action}`, {
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
