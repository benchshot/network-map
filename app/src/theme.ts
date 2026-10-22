import { useColorScheme } from 'react-native';
import type { DeviceKind, Severity } from './types';

export type Group = 'infrastructure' | 'computers' | 'personal' | 'media' | 'smartHome' | 'unknown';

const light = {
  page: '#f9f9f7',
  surface: '#fcfcfb',
  raised: '#ffffff',
  border: '#e1e0d9',
  text: '#0b0b0b',
  textSecondary: '#52514e',
  muted: '#898781',
  accent: '#2a78d6',
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
  edge: '#c9c8c1',
  edgeActive: '#2a78d6',
  groups: {
    infrastructure: '#2a78d6',
    computers: '#eb6834',
    personal: '#1baf7a',
    media: '#eda100',
    smartHome: '#e87ba4',
    unknown: '#898781',
  } as Record<Group, string>,
};

const dark: typeof light = {
  page: '#0d0d0d',
  surface: '#1a1a19',
  raised: '#232321',
  border: '#2c2c2a',
  text: '#f0efec',
  textSecondary: '#c3c2b7',
  muted: '#898781',
  accent: '#3987e5',
  good: '#0ca30c',
  warning: '#fab219',
  serious: '#ec835a',
  critical: '#d03b3b',
  edge: '#3a3a37',
  edgeActive: '#3987e5',
  groups: {
    infrastructure: '#3987e5',
    computers: '#d95926',
    personal: '#199e70',
    media: '#c98500',
    smartHome: '#d55181',
    unknown: '#898781',
  },
};

export type Theme = typeof light;

export function useTheme(): Theme {
  return useColorScheme() === 'dark' ? dark : light;
}

export const GROUP_LABELS: Record<Group, string> = {
  infrastructure: 'Network gear',
  computers: 'Computers & servers',
  personal: 'Phones & tablets',
  media: 'TV & audio',
  smartHome: 'Smart home',
  unknown: 'Unidentified',
};

export const GROUP_ORDER: Group[] = ['infrastructure', 'computers', 'personal', 'media', 'smartHome', 'unknown'];

export const KINDS: Record<DeviceKind, { label: string; icon: string; group: Group }> = {
  gateway: { label: 'Router / gateway', icon: 'router-network', group: 'infrastructure' },
  switch: { label: 'Switch', icon: 'switch', group: 'infrastructure' },
  ap: { label: 'Access point', icon: 'access-point', group: 'infrastructure' },
  server: { label: 'Server', icon: 'server', group: 'computers' },
  nas: { label: 'NAS / storage', icon: 'nas', group: 'computers' },
  computer: { label: 'Computer', icon: 'laptop', group: 'computers' },
  phone: { label: 'Phone', icon: 'cellphone', group: 'personal' },
  tablet: { label: 'Tablet', icon: 'tablet', group: 'personal' },
  tv: { label: 'TV / streamer', icon: 'television', group: 'media' },
  speaker: { label: 'Speaker', icon: 'speaker', group: 'media' },
  console: { label: 'Game console', icon: 'controller', group: 'media' },
  camera: { label: 'Camera', icon: 'cctv', group: 'smartHome' },
  printer: { label: 'Printer', icon: 'printer', group: 'smartHome' },
  iot: { label: 'Smart device', icon: 'home-automation', group: 'smartHome' },
  unknown: { label: 'Unknown', icon: 'help-circle-outline', group: 'unknown' },
};

export const KIND_ORDER = Object.keys(KINDS) as DeviceKind[];

/** Status colors carry severity, always next to an icon and a label. */
export const SEVERITY: Record<Severity, { label: string; icon: string; color: (t: Theme) => string }> = {
  critical: { label: 'Critical', icon: 'shield-alert', color: (t) => t.critical },
  high: { label: 'High', icon: 'alert-octagon', color: (t) => t.serious },
  medium: { label: 'Medium', icon: 'alert', color: (t) => t.warning },
  low: { label: 'Low', icon: 'information', color: (t) => t.muted },
};

export const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'medium', 'low'];
