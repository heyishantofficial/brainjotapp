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
    const res = await apiInstance.post(`?action=${action}`, fd);
    return res.data;
  } catch (error) {
    if (error.response?.data) return error.response.data;
    throw error;
  }
}
