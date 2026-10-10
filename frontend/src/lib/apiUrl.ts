/** Build API URLs for local same-origin development or a separately deployed API. */
const API_BASE_URL = ((import.meta as ImportMeta & { env?: { VITE_API_BASE_URL?: string } }).env?.VITE_API_BASE_URL || '').replace(/\/+$/, '');

export function apiUrl(path: string): string {
  return `${API_BASE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}

export function apiFetch(path: string, init: RequestInit = {}): Promise<Response> {
  return fetch(apiUrl(path), { ...init, credentials: 'include' });
}
