import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import os from 'node:os';
import dns from 'node:dns/promises';
import net from 'node:net';
import http from 'node:http';
import type { OpenPort } from './types.ts';

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
  21: 'FTP',
  22: 'SSH',
  23: 'Telnet',
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
  2375: 'Docker API',
  3000: 'Web app',
  3306: 'MySQL',
  3389: 'Remote Desktop',
  5000: 'Web (5000)',
  5001: 'Synology HTTPS',
  5432: 'PostgreSQL',
  5555: 'Android ADB',
  5900: 'VNC / Screen Sharing',
  6379: 'Redis',
  7000: 'AirPlay',
  8000: 'Web app',
  8008: 'Chromecast',
  8080: 'HTTP alt',
  8123: 'Home Assistant',
  8443: 'HTTPS alt',
  8888: 'Web app',
  9000: 'Web / Portainer',
  9100: 'Printer (raw)',
  9200: 'Elasticsearch',
  11211: 'Memcached',
  27017: 'MongoDB',
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

const HTTP_PORTS = [80, 3000, 5000, 8000, 8080, 8123, 8888, 9000];

interface Page {
  status: number;
  headers: http.IncomingHttpHeaders;
  body: string;
}

/**
 * A plain GET using Node's lenient parser. Many routers and IoT devices send malformed responses
 * (Content-Length and chunked together, for example) that fetch refuses outright.
 */
function get(url: string, timeoutMs = 1500): Promise<Page> {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { insecureHTTPParser: true, timeout: timeoutMs }, (res) => {
      let body = '';
      res.setEncoding('latin1');
      res.on('data', (chunk: string) => {
        body += chunk;
        if (body.length > 50000) res.destroy();
      });
      res.on('close', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      res.on('error', reject);
    });
    req.on('timeout', () => req.destroy(new Error('timeout')));
    req.on('error', reject);
  });
}

/**
 * Loads the page on a plain-HTTP port, following up to three redirects (including <meta refresh>).
 * Reports whether it ends up on HTTPS and whether it asks for a password, which is what the security check needs.
 */
export async function httpProbe(ip: string, port: number): Promise<{ title?: string; https: boolean; login: boolean } | undefined> {
  let url = `http://${ip}:${port}/`;
  let title: string | undefined;
  try {
    for (let hop = 0; hop < 4; hop++) {
      const page = await get(url);
      const passwordField = /<input[^>]+(type\s*=\s*["']?password|(name|id)\s*=\s*["'][^"']*password)/i.test(page.body);
      const refresh = page.body.match(/<meta[^>]+http-equiv\s*=\s*["']?refresh[^>]+url\s*=\s*['"]?([^"'>\s]+)/i)?.[1];
      const location = page.status >= 300 && page.status < 400 ? page.headers.location : refresh;
      title ??= page.body.match(/<title[^>]*>([^<]{1,80})<\/title>/i)?.[1].trim() || undefined;
      if (location && hop < 3 && !passwordField) {
        url = new URL(location, url).toString();
        if (url.startsWith('https:')) return { title, https: true, login: false };
        continue;
      }
      return {
        title,
        https: false,
        // Digest auth never sends the password itself, so only Basic counts.
        login:
          passwordField ||
          /login|signin/i.test(new URL(url).pathname) ||
          (page.status === 401 && /^basic/i.test(String(page.headers['www-authenticate'] ?? ''))),
      };
    }
  } catch {
    // Not HTTP, or it didn't answer in time.
  }
  return undefined;
}

/** Sends the first message of a protocol's normal handshake and returns the first bytes of the reply. */
function firstReply(ip: string, port: number, hello: Buffer, timeoutMs = 2000): Promise<string | undefined> {
  return new Promise((resolve) => {
    const socket = net.connect({ host: ip, port });
    const done = (reply?: string) => {
      socket.destroy();
      resolve(reply);
    };
    socket.setTimeout(timeoutMs, () => done());
    socket.once('connect', () => socket.write(hello));
    socket.once('data', (data: Buffer) => done(data.subarray(0, 64).toString('latin1')));
    socket.once('error', () => done());
  });
}

function adbConnect(): Buffer {
  const command = 0x4e584e43; // "CNXN"
  const message = Buffer.alloc(24);
  message.writeUInt32LE(command, 0);
  message.writeUInt32LE(0x01000000, 4);
  message.writeUInt32LE(4096, 8);
  message.writeUInt32LE((command ^ 0xffffffff) >>> 0, 20);
  return message;
}

/**
 * Whether a service lets anyone in without credentials. This only opens the conversation the way a normal
 * client would and reads the greeting; it never sends credentials or commands.
 */
export async function authCheck(ip: string, port: number): Promise<OpenPort['auth']> {
  if (port === 5555) {
    const reply = await firstReply(ip, port, adbConnect());
    return reply?.startsWith('AUTH') ? 'required' : reply?.startsWith('CNXN') ? 'none' : undefined;
  }
  if (port === 6379) {
    const reply = await firstReply(ip, port, Buffer.from('PING\r\n'));
    return reply?.startsWith('+PONG') ? 'none' : reply?.includes('NOAUTH') || reply?.includes('DENIED') ? 'required' : undefined;
  }
  return undefined;
}

export async function probeHosts(ips: string[]): Promise<Map<string, OpenPort[]>> {
  const jobs = ips.flatMap((ip) => Object.keys(PROBE_PORTS).map((port) => ({ ip, port: Number(port) })));
  const open = new Map<string, OpenPort[]>();
  await mapLimit(jobs, 128, async ({ ip, port }) => {
    if (!(await probePort(ip, port))) return;
    const page = HTTP_PORTS.includes(port) ? await httpProbe(ip, port) : undefined;
    const auth = await authCheck(ip, port);
    const list = open.get(ip) ?? [];
    list.push({ port, service: PROBE_PORTS[port], title: page?.title, web: page && { https: page.https, login: page.login }, auth });
    open.set(ip, list);
  });
  for (const list of open.values()) list.sort((a, b) => a.port - b.port);
  return open;
}

export { mapLimit };
