import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import dns from 'node:dns/promises';
import net from 'node:net';

const run = promisify(execFile);

export interface LocalInterface {
  name: string;
  ip: string;
  mac: string;
  netmask: string;
  cidr: string;
}

export function normalizeMac(mac: string): string {
  return mac
    .toLowerCase()
    .split(/[:-]/)
    .map((part) => part.padStart(2, '0'))
    .join(':');
}

/** Locally administered MACs (2nd hex digit 2/6/a/e) are almost always phone/OS privacy addresses. */
export function isRandomizedMac(mac: string): boolean {
  return ['2', '6', 'a', 'e'].includes(mac[1]);
}

function ipToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;
}

function intToIp(n: number): string {
  return [24, 16, 8, 0].map((shift) => (n >>> shift) & 255).join('.');
}

export function localInterface(preferred?: string): LocalInterface | undefined {
  const all = os.networkInterfaces();
  const names = preferred ? [preferred] : Object.keys(all);
  for (const name of names) {
    for (const addr of all[name] ?? []) {
      if (addr.family === 'IPv4' && !addr.internal && !addr.address.startsWith('169.254.')) {
        return { name, ip: addr.address, mac: normalizeMac(addr.mac), netmask: addr.netmask, cidr: addr.cidr ?? '' };
      }
    }
  }
  return undefined;
}

/** Node reports 02:00:00:00:00:00 on recent macOS, so ask ifconfig for the real hardware address. */
export async function interfaceMac(iface: LocalInterface): Promise<string> {
  if (iface.mac !== '02:00:00:00:00:00' && iface.mac !== '00:00:00:00:00:00') return iface.mac;
  try {
    const { stdout } = await run('ifconfig', [iface.name]);
    const mac = stdout.match(/ether ([0-9a-f:]+)/i)?.[1];
    return mac ? normalizeMac(mac) : iface.mac;
  } catch {
    return iface.mac;
  }
}

export async function defaultGateway(): Promise<string | undefined> {
  try {
    if (process.platform === 'darwin') {
      const { stdout } = await run('route', ['-n', 'get', 'default']);
      return stdout.match(/gateway:\s+(\S+)/)?.[1];
    }
    const { stdout } = await run('ip', ['route', 'show', 'default']);
    return stdout.match(/default via (\S+)/)?.[1];
  } catch {
    return undefined;
  }
}

/** Every host address in the interface's subnet, capped at a /22 so a big netmask can't stall the scan. */
export function subnetHosts(iface: LocalInterface): string[] {
  const mask = Math.max(ipToInt(iface.netmask), ipToInt('255.255.252.0'));
  const network = (ipToInt(iface.ip) & mask) >>> 0;
  const broadcast = (network | ~mask) >>> 0;
  const hosts: string[] = [];
  for (let n = network + 1; n < broadcast; n++) hosts.push(intToIp(n));
  return hosts;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

function ping(ip: string): Promise<boolean> {
  const args = process.platform === 'darwin' ? ['-c', '1', '-W', '600', ip] : ['-c', '1', '-W', '1', ip];
  return new Promise((resolve) => {
    const child = spawn('ping', args, { stdio: 'ignore' });
    child.on('error', () => resolve(false));
    child.on('exit', (code) => resolve(code === 0));
  });
}

/** Pings the whole subnet so the OS fills its ARP table, then returns the hosts that answered. */
export async function pingSweep(hosts: string[]): Promise<Set<string>> {
  const alive = new Set<string>();
  await mapLimit(hosts, 64, async (ip) => {
    if (await ping(ip)) alive.add(ip);
  });
  return alive;
}

/** IP → MAC from the OS neighbour table. Devices that ignore ping still show up here. */
export async function readArpTable(): Promise<Map<string, string>> {
  const table = new Map<string, string>();
  try {
    if (process.platform === 'darwin') {
      const { stdout } = await run('arp', ['-an']);
      for (const line of stdout.split('\n')) {
        const m = line.match(/\((\d+\.\d+\.\d+\.\d+)\) at ([0-9a-f:]+) on/i);
        if (m) table.set(m[1], normalizeMac(m[2]));
      }
    } else {
      const { stdout } = await run('ip', ['neigh', 'show']);
      for (const line of stdout.split('\n')) {
        const m = line.match(/^(\d+\.\d+\.\d+\.\d+) .*lladdr ([0-9a-f:]+)/i);
        if (m && !/FAILED|INCOMPLETE/.test(line)) table.set(m[1], normalizeMac(m[2]));
      }
    }
  } catch {
    // No neighbour table available; ping results still give IPs.
  }
  for (const [ip, mac] of table) {
    if (mac === 'ff:ff:ff:ff:ff:ff' || ip.endsWith('.255') || ip.startsWith('224.')) table.delete(ip);
  }
  return table;
}

export async function reverseLookup(ip: string): Promise<string | undefined> {
  try {
    const names = await Promise.race([dns.reverse(ip), new Promise<string[]>((resolve) => setTimeout(() => resolve([]), 1500))]);
    return names[0]?.replace(/\.$/, '');
  } catch {
    return undefined;
  }
}

export const PROBE_PORTS: Record<number, string> = {
  22: 'SSH',
  53: 'DNS',
  80: 'HTTP',
  139: 'NetBIOS',
  443: 'HTTPS',
  445: 'SMB',
  548: 'AFP',
  554: 'RTSP camera',
  631: 'Printing (IPP)',
  1400: 'Sonos',
  1883: 'MQTT',
  3000: 'Web app',
  3389: 'Remote Desktop',
  5000: 'Web (5000)',
  5001: 'Synology HTTPS',
  5432: 'PostgreSQL',
  5555: 'Android ADB',
  5900: 'VNC / Screen Sharing',
  7000: 'AirPlay',
  8008: 'Chromecast',
  8080: 'HTTP alt',
  8123: 'Home Assistant',
  8443: 'HTTPS alt',
  8888: 'Web app',
  9000: 'Web / Portainer',
  9100: 'Printer (raw)',
  32400: 'Plex',
  49152: 'UPnP',
  62078: 'iOS sync',
};

function probePort(ip: string, port: number, timeoutMs = 700): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: ip, port });
    const done = (open: boolean) => {
      socket.destroy();
      resolve(open);
    };
    socket.setTimeout(timeoutMs, () => done(false));
    socket.once('connect', () => done(true));
    socket.once('error', () => done(false));
  });
}

async function httpTitle(ip: string, port: number): Promise<string | undefined> {
  const scheme = [443, 5001, 8443].includes(port) ? 'https' : 'http';
  if (scheme === 'https') return undefined;
  try {
    const res = await fetch(`${scheme}://${ip}:${port}/`, { signal: AbortSignal.timeout(1500), redirect: 'follow' });
    const html = (await res.text()).slice(0, 20000);
    return html.match(/<title[^>]*>([^<]{1,80})<\/title>/i)?.[1].trim() || undefined;
  } catch {
    return undefined;
  }
}

export async function probeHosts(ips: string[]): Promise<Map<string, { port: number; service: string; title?: string }[]>> {
  const jobs = ips.flatMap((ip) => Object.keys(PROBE_PORTS).map((port) => ({ ip, port: Number(port) })));
  const open = new Map<string, { port: number; service: string; title?: string }[]>();
  await mapLimit(jobs, 128, async ({ ip, port }) => {
    if (!(await probePort(ip, port))) return;
    const title = [80, 3000, 5000, 8080, 8123, 8888, 9000].includes(port) ? await httpTitle(ip, port) : undefined;
    const list = open.get(ip) ?? [];
    list.push({ port, service: PROBE_PORTS[port], title });
    open.set(ip, list);
  });
  for (const list of open.values()) list.sort((a, b) => a.port - b.port);
  return open;
}

export { mapLimit };
