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
  /** Set for ports that answered HTTP. */
  web?: { https: boolean; login: boolean };
  /** From a handshake on services that may allow anyone in: ADB and Redis. */
  auth?: 'none' | 'required';
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
  /** Finding keys the user has marked as expected, e.g. "port:22". */
  acceptedFindings?: string[];
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
  security: { findings: Finding[]; upnp?: UpnpStatus };
}

export type Severity = 'critical' | 'high' | 'medium' | 'low';

export interface Finding {
  /** Unique across the snapshot: `${deviceId}|${key}`. */
  id: string;
  /** Stable per device, used to remember that the user accepted it. */
  key: string;
  deviceId?: string;
  category: 'internet' | 'service' | 'web';
  severity: Severity;
  title: string;
  detail: string;
  fix: string;
  port?: number;
  accepted: boolean;
}

export interface PortMapping {
  externalPort: number;
  internalPort: number;
  protocol: 'TCP' | 'UDP';
  internalClient: string;
  description?: string;
  enabled: boolean;
  /** 0 means the mapping never expires. */
  leaseSeconds: number;
}

export interface UpnpStatus {
  available: boolean;
  gateway?: string;
  externalIp?: string;
  mappings: PortMapping[];
  checkedAt: string;
  error?: string;
}
