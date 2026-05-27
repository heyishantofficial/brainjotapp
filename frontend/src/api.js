import axios from 'axios';

const apiInstance = axios.create({
  baseURL: '/api',
  withCredentials: true,
});

export async function api(action, body = null, method = 'POST') {
  try {
    const config = { method, url: `?action=${action}` };
    if (body && method !== 'GET') {
      config.data = body;
    }
    if (import.meta.env.DEV) {
      console.log(`[API CALL] ${method} ${action}`, body);
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
    const res = await apiInstance.post(`?action=${action}`, fd, {
      headers: { 'Content-Type': 'multipart/form-data' },
    });
    return res.data;
  } catch (error) {
    if (error.response?.data) return error.response.data;
    throw error;
  }
}
