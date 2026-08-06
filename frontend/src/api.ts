import type { SessionDetail, SessionSummary } from './types';

function resolveApiBase(): string {
  const envBase = (import.meta as { env?: { VITE_API_BASE?: string } } | undefined)?.env
    ?.VITE_API_BASE;
  if (envBase && envBase.trim()) {
    return envBase;
  }

  if (typeof window !== 'undefined') {
    const { protocol, hostname, port } = window.location;
    if ((hostname === '127.0.0.1' || hostname === 'localhost') && port !== '8000') {
      return `${protocol}//${hostname}:8000/api`;
    }
  }

  return '/api';
}

const API_BASE = resolveApiBase();

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, init);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(body || `Request failed with status ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export function listSessions() {
  return requestJson<SessionSummary[]>('/sessions');
}

export function loadSession(sessionId: number) {
  return requestJson<SessionDetail>(`/sessions/${sessionId}`);
}

export async function uploadSession(params: {
  logFile: File;
  mappingText: string;
  mappingFile?: File | null;
  notes?: string;
}): Promise<SessionDetail> {
  const formData = new FormData();
  formData.append('log_file', params.logFile);
  formData.append('mapping_text', params.mappingText);
  formData.append('notes', params.notes ?? '');
  if (params.mappingFile) {
    formData.append('mapping_file', params.mappingFile);
  }

  return requestJson<SessionDetail>('/sessions/upload', {
    method: 'POST',
    body: formData,
  });
}
