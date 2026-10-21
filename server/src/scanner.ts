import fs from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import {
  defaultGateway,
  interfaceMac,
  isRandomizedMac,
  localInterface,
  mapLimit,
  pingSweep,
  probeHosts,
  readArpTable,
  reverseLookup,
  subnetHosts,
} from './discover.ts';
import { browseMdns } from './mdns.ts';
import { guessKind } from './classify.ts';
import type { Device, DeviceKind, Link, RouterAdapter, RouterClient, Snapshot, Source } from './types.ts';

const ouiTable: Record<string, string> = createRequire(import.meta.url)('oui-data');

function vendorFor(mac: string): string | undefined {
  if (isRandomizedMac(mac)) return undefined;
  return ouiTable[mac.replace(/:/g, '').slice(0, 6).toUpperCase()]?.split('\n')[0];
}

export type DeviceEdit = Partial<Pick<Device, 'name' | 'notes' | 'owner' | 'acknowledged'>> & { kind?: DeviceKind | 'auto' };

export class Scanner {
  private devices = new Map<string, Device>();
  private scanning = false;
  private scanStage?: string;
  private lastScanAt?: string;
  private lastScanMs?: number;
  private subnet?: string;
  private gatewayId?: string;
  private routerStatus: Snapshot['routers'] = [];
  private warnings: string[] = [];
  private readonly file: string;
  private readonly routers: RouterAdapter[];
  private readonly interfaceName?: string;

  constructor(dataDir: string, routers: RouterAdapter[], interfaceName?: string) {
    this.file = path.join(dataDir, 'devices.json');
    this.routers = routers;
    this.interfaceName = interfaceName;
  }

  async load() {
    try {
      const saved = JSON.parse(await fs.readFile(this.file, 'utf8')) as { devices: Device[]; lastScanAt?: string };
      for (const d of saved.devices) this.devices.set(d.id, { ...d, online: false });
      this.lastScanAt = saved.lastScanAt;
    } catch {
      // First run.
    }
  }

  private async save() {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const body = JSON.stringify({ lastScanAt: this.lastScanAt, devices: [...this.devices.values()] }, null, 2);
    await fs.writeFile(`${this.file}.tmp`, body);
    await fs.rename(`${this.file}.tmp`, this.file);
  }

  snapshot(): Snapshot {
    const devices = [...this.devices.values()];
    const links: Link[] = [];
    for (const d of devices) {
      if (d.id === this.gatewayId) continue;
      const parent = d.connection.via && this.devices.has(d.connection.via) ? d.connection.via : this.gatewayId;
      if (parent && parent !== d.id) links.push({ source: parent, target: d.id, medium: d.connection.medium });
    }
    return {
      devices,
      links,
      subnet: this.subnet,
      gatewayId: this.gatewayId,
      scanning: this.scanning,
      scanStage: this.scanStage,
      lastScanAt: this.lastScanAt,
      lastScanMs: this.lastScanMs,
      routers: this.routerStatus,
      warnings: this.warnings,
    };
  }

  async edit(id: string, edit: DeviceEdit): Promise<Device | undefined> {
    const device = this.devices.get(id);
    if (!device) return undefined;
    if (edit.name !== undefined) device.name = edit.name.trim() || undefined;
    if (edit.notes !== undefined) device.notes = edit.notes.trim() || undefined;
    if (edit.owner !== undefined) device.owner = edit.owner.trim() || undefined;
    if (edit.acknowledged !== undefined) device.acknowledged = edit.acknowledged;
    if (edit.kind === 'auto') {
      device.kindSetByUser = false;
      device.kind = guessKind(device, this.gatewayIp());
    } else if (edit.kind) {
      device.kindSetByUser = true;
      device.kind = edit.kind;
    }
    await this.save();
    return device;
  }

  async forget(id: string): Promise<boolean> {
    const removed = this.devices.delete(id);
    if (removed) await this.save();
    return removed;
  }

  private gatewayIp() {
    return this.gatewayId ? this.devices.get(this.gatewayId)?.ip : undefined;
  }

  /** Devices whose MAC we couldn't read are keyed by IP until a later scan learns the MAC. */
  private upsertHost(ip: string, mac: string | undefined, now: string): Device {
    if (!mac) {
      const known = [...this.devices.values()].find((d) => d.ip === ip && d.mac);
      if (known) return known;
      const id = `ip-${ip}`;
      let device = this.devices.get(id);
      if (!device) {
        device = this.upsert(id, now, 'scan');
        device.mac = undefined;
        device.randomizedMac = false;
        device.vendor = undefined;
      }
      return device;
    }
    const device = this.upsert(mac, now, 'scan');
    const placeholder = this.devices.get(`ip-${ip}`);
    if (placeholder) {
      device.name ??= placeholder.name;
      device.notes ??= placeholder.notes;
      device.owner ??= placeholder.owner;
      if (placeholder.kindSetByUser && !device.kindSetByUser) {
        device.kind = placeholder.kind;
        device.kindSetByUser = true;
      }
      if (placeholder.firstSeen < device.firstSeen) device.firstSeen = placeholder.firstSeen;
      device.acknowledged ||= placeholder.acknowledged;
      this.devices.delete(placeholder.id);
    }
    return device;
  }

  private upsert(mac: string, now: string, source: Source): Device {
    let device = this.devices.get(mac);
    if (!device) {
      device = {
        id: mac,
        mac,
        randomizedMac: isRandomizedMac(mac),
        vendor: vendorFor(mac),
        kind: 'unknown',
        kindSetByUser: false,
        ports: [],
        mdnsServices: [],
        connection: { medium: 'unknown' },
        online: false,
        isSelf: false,
        firstSeen: now,
        lastSeen: now,
        acknowledged: false,
        sources: [],
      };
      this.devices.set(mac, device);
    }
    if (!device.sources.includes(source)) device.sources.push(source);
    return device;
  }

  async scan(): Promise<void> {
    if (this.scanning) return;
    this.scanning = true;
    const started = Date.now();
    const now = new Date().toISOString();
    const firstScan = !this.lastScanAt && this.devices.size === 0;
    try {
      const iface = localInterface(this.interfaceName);
      if (!iface) throw new Error('No active IPv4 network interface found');
      this.subnet = iface.cidr;
      const gatewayIp = await defaultGateway();

      this.scanStage = 'Pinging subnet and listening for Bonjour';
      const [alive, mdnsHosts] = await Promise.all([pingSweep(subnetHosts(iface)), browseMdns(5000)]);

      this.scanStage = 'Reading neighbour table';
      const arp = await readArpTable();
      const selfMac = await interfaceMac(iface);
      const macsHidden = arp.size === 0 && alive.size > 1;
      this.warnings = macsHidden
        ? [
            'macOS is hiding MAC addresses from this process, so devices are tracked by IP and vendors are unknown. ' +
              'Allow Local Network access for your terminal (or node) in System Settings → Privacy & Security → Local Network, then restart the scanner.',
          ]
        : [];
      const hosts = new Map<string, string | undefined>();
      for (const ip of alive) hosts.set(ip, undefined);
      for (const [ip, host] of mdnsHosts) hosts.set(ip, host.mac);
      for (const [ip, mac] of arp) hosts.set(ip, mac);
      hosts.set(iface.ip, selfMac === '02:00:00:00:00:00' ? undefined : selfMac);

      this.scanStage = 'Asking routers';
      const routerClients = await this.queryRouters();

      for (const d of this.devices.values()) d.online = false;

      for (const [ip, mac] of hosts) {
        const device = this.upsertHost(ip, mac, now);
        device.ip = ip;
        device.isSelf = ip === iface.ip;
        // ARP entries linger after a device leaves, so a bare entry doesn't count as online.
        if (alive.has(ip) || mdnsHosts.has(ip) || device.isSelf || ip === gatewayIp) {
          device.online = true;
          device.lastSeen = now;
        }
      }

      const routerKinds = new Set<string>();
      for (const { client, source } of routerClients) {
        this.mergeRouterClient(client, source, now);
        if (client.kind) routerKinds.add(client.mac);
      }

      for (const [ip, host] of mdnsHosts) {
        const device = [...this.devices.values()].find((d) => d.ip === ip);
        if (!device) continue;
        if (!device.sources.includes('mdns')) device.sources.push('mdns');
        device.hostname = host.hostname ?? device.hostname;
        device.model = host.model ?? device.model;
        device.advertisedName = host.friendlyName ?? device.advertisedName;
        device.mdnsServices = [...host.services].sort();
      }

      this.gatewayId = gatewayIp ? [...this.devices.values()].find((d) => d.ip === gatewayIp)?.id : undefined;

      const online = [...this.devices.values()].filter((d) => d.online && d.ip);
      this.scanStage = `Checking services on ${online.length} devices`;
      const openPorts = await probeHosts(online.map((d) => d.ip!));
      await mapLimit(online, 16, async (d) => {
        d.ports = (openPorts.get(d.ip!) ?? []).map((p) =>
          p.port === 5000 && d.mdnsServices.includes('AirPlay') ? { ...p, service: 'AirPlay control' } : p,
        );
        if (!d.hostname) d.hostname = await reverseLookup(d.ip!);
      });

      for (const d of this.devices.values()) {
        if (firstScan) d.acknowledged = true;
        if (!d.kindSetByUser && !routerKinds.has(d.id)) d.kind = guessKind(d, gatewayIp);
      }

      this.lastScanAt = now;
      this.lastScanMs = Date.now() - started;
      await this.save();
    } finally {
      this.scanning = false;
      this.scanStage = undefined;
    }
  }

  private async queryRouters(): Promise<{ client: RouterClient; source: Source }[]> {
    const results = await Promise.allSettled(this.routers.map((r) => r.fetchClients()));
    this.routerStatus = results.map((r, i) => ({
      name: this.routers[i].name,
      ok: r.status === 'fulfilled',
      error: r.status === 'rejected' ? String(r.reason?.message ?? r.reason) : undefined,
    }));
    return results.flatMap((r, i) => (r.status === 'fulfilled' ? r.value.map((client) => ({ client, source: this.routers[i].name })) : []));
  }

  private mergeRouterClient(client: RouterClient, source: Source, now: string) {
    const device = this.upsert(client.mac, now, source);
    if (client.ip) device.ip = client.ip;
    if (client.hostname) device.hostname = client.hostname;
    if (client.model) device.model = client.model;
    if (client.name && !device.name) device.name = client.name;
    if (client.kind && !device.kindSetByUser) device.kind = client.kind;
    if (client.connection) device.connection = client.connection;
    if (client.traffic) device.traffic = client.traffic;
    if (client.online) {
      device.online = true;
      device.lastSeen = now;
    }
  }
}
