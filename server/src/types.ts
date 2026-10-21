export type DeviceKind =
  | 'gateway'
  | 'switch'
  | 'ap'
  | 'server'
  | 'nas'
  | 'computer'
  | 'phone'
  | 'tablet'
  | 'tv'
  | 'speaker'
  | 'camera'
  | 'printer'
  | 'iot'
  | 'console'
  | 'unknown';

export type Source = 'scan' | 'mdns' | 'unifi' | 'openwrt';

export interface OpenPort {
  port: number;
  service: string;
  title?: string;
}

export interface Connection {
  via?: string;
  medium: 'wired' | 'wifi' | 'unknown';
  ssid?: string;
  signal?: number;
  switchPort?: number;
}

export interface Device {
  id: string;
  mac?: string;
  ip?: string;
  hostname?: string;
  /** Name the device announces over Bonjour, e.g. "Living Room". */
  advertisedName?: string;
  vendor?: string;
  model?: string;
  randomizedMac: boolean;
  kind: DeviceKind;
  kindSetByUser: boolean;
  name?: string;
  notes?: string;
  owner?: string;
  ports: OpenPort[];
  mdnsServices: string[];
  connection: Connection;
  traffic?: { rxBytes: number; txBytes: number };
  online: boolean;
  isSelf: boolean;
  firstSeen: string;
  lastSeen: string;
  acknowledged: boolean;
  sources: Source[];
}

export interface Link {
  source: string;
  target: string;
  medium: Connection['medium'];
}

export interface Snapshot {
  devices: Device[];
  links: Link[];
  subnet?: string;
  gatewayId?: string;
  scanning: boolean;
  scanStage?: string;
  lastScanAt?: string;
  lastScanMs?: number;
  routers: { name: string; ok: boolean; error?: string }[];
  warnings: string[];
}

/** What a router adapter knows about one client or piece of infrastructure. */
export interface RouterClient {
  mac: string;
  ip?: string;
  hostname?: string;
  name?: string;
  model?: string;
  kind?: DeviceKind;
  online: boolean;
  connection?: Connection;
  traffic?: { rxBytes: number; txBytes: number };
}

export interface RouterAdapter {
  name: Source;
  fetchClients(): Promise<RouterClient[]>;
}
