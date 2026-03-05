const rawApiBase = (import.meta.env.VITE_API_BASE_URL || '').trim();
const normalizedApiBase = rawApiBase.replace(/\/+$/, '');
const AUTH_TOKEN_STORAGE_KEY = 'smart_point_auth_token';
let runtimeAuthToken = '';

function normalizePath(path: string): string {
  if (!path) return '/';
  return path.startsWith('/') ? path : `/${path}`;
}

export function apiUrl(path: string): string {
  const normalizedPath = normalizePath(path);
  return normalizedApiBase ? `${normalizedApiBase}${normalizedPath}` : normalizedPath;
}

export function getStoredAuthToken(): string {
  if (typeof window === 'undefined') return '';
  if (runtimeAuthToken) return runtimeAuthToken;
  try {
    const fromLocal = String(window.localStorage.getItem(AUTH_TOKEN_STORAGE_KEY) || '').trim();
    if (fromLocal) {
      runtimeAuthToken = fromLocal;
      return fromLocal;
    }
  } catch {
    // noop
  }
  try {
    const fromSession = String(window.sessionStorage.getItem(AUTH_TOKEN_STORAGE_KEY) || '').trim();
    if (fromSession) {
      runtimeAuthToken = fromSession;
      return fromSession;
    }
  } catch {
    // noop
  }
  return '';
}

export function setStoredAuthToken(token: string): void {
  if (typeof window === 'undefined') return;
  const safe = String(token || '').trim();
  runtimeAuthToken = safe;
  try {
    if (!safe) {
      window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
    } else {
      window.localStorage.setItem(AUTH_TOKEN_STORAGE_KEY, safe);
    }
  } catch {
    try {
      if (!safe) {
        window.sessionStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
      } else {
        window.sessionStorage.setItem(AUTH_TOKEN_STORAGE_KEY, safe);
      }
    } catch {
      // noop
    }
  }
}

export function clearStoredAuthToken(): void {
  if (typeof window === 'undefined') return;
  runtimeAuthToken = '';
  try {
    window.localStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  } catch {
    // noop
  }
  try {
    window.sessionStorage.removeItem(AUTH_TOKEN_STORAGE_KEY);
  } catch {
    // noop
  }
}

export function apiFetch(path: string, init?: RequestInit): Promise<Response> {
  const headers = new Headers(init?.headers || {});
  const token = getStoredAuthToken();
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  return fetch(apiUrl(path), {
    ...init,
    credentials: init?.credentials ?? 'include',
    headers
  });
}

export function isApiUnavailableInCurrentHost(): boolean {
  if (typeof window === 'undefined') return false;
  const isGithubPages = /\.github\.io$/i.test(window.location.hostname);
  return isGithubPages && !normalizedApiBase;
}
