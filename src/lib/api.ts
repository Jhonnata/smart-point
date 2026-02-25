const rawApiBase = (import.meta.env.VITE_API_BASE_URL || '').trim();
const normalizedApiBase = rawApiBase.replace(/\/+$/, '');

function normalizePath(path: string): string {
  if (!path) return '/';
  return path.startsWith('/') ? path : `/${path}`;
}

export function apiUrl(path: string): string {
  const normalizedPath = normalizePath(path);
  return normalizedApiBase ? `${normalizedApiBase}${normalizedPath}` : normalizedPath;
}

export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(apiUrl(path), {
    credentials: init?.credentials ?? 'include',
    ...init
  });
}

export function isApiUnavailableInCurrentHost(): boolean {
  if (typeof window === 'undefined') return false;
  const isGithubPages = /\.github\.io$/i.test(window.location.hostname);
  return isGithubPages && !normalizedApiBase;
}
