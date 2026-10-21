import { KINDS } from './theme';
import type { Device, DeviceKind, Snapshot } from './types';

export const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4319';

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return (res.status === 204 ? undefined : await res.json()) as T;
}

export type DeviceEdit = Partial<Pick<Device, 'name' | 'notes' | 'owner' | 'acknowledged'>> & { kind?: DeviceKind | 'auto' };

export const api = {
  snapshot: () => request<Snapshot>('/api/snapshot'),
  scan: () => request<{ scanning: boolean }>('/api/scan', { method: 'POST' }),
  edit: (id: string, edit: DeviceEdit) =>
    request<Device>(`/api/devices/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(edit) }),
  forget: (id: string) => request<void>(`/api/devices/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

const generated = /^[0-9a-f-]{12,}$|[0-9a-f]{16,}|^none$/i;

/** The most human name we have, skipping serial-number style hostnames. */
export function displayName(d: Device): string {
  const candidate = [d.name, d.advertisedName, d.hostname, d.vendor].find((v) => v && !generated.test(v));
  if (candidate) return candidate;
  if (d.kind === 'gateway') return 'Router';
  return d.ip ? `${KINDS[d.kind].label} .${d.ip.split('.').pop()}` : d.id;
}

export function timeAgo(iso?: string): string {
  if (!iso) return 'never';
  const seconds = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'just now';
  if (seconds < 3600) return `${Math.round(seconds / 60)} min ago`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h ago`;
  return `${Math.round(seconds / 86400)} d ago`;
}

export function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let i = 0;
  while (bytes >= 1024 && i < units.length - 1) {
    bytes /= 1024;
    i++;
  }
  return `${bytes.toFixed(i ? 1 : 0)} ${units[i]}`;
}
