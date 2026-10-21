import { Agent } from 'undici';
import { normalizeMac } from '../discover.ts';
import type { DeviceKind, RouterAdapter, RouterClient } from '../types.ts';

// UniFi consoles ship self-signed certificates.
const insecure = new Agent({ connect: { rejectUnauthorized: false } });

interface Options {
  url: string;
  username: string;
  password: string;
  site: string;
  /** UniFi OS consoles (UDM, UCG, Cloud Key Gen2+) prefix the Network API with /proxy/network. */
  unifiOs: boolean;
}

const DEVICE_KINDS: Record<string, DeviceKind> = { ugw: 'gateway', udm: 'gateway', uxg: 'gateway', usw: 'switch', uap: 'ap' };

export function unifiAdapter(opts: Options): RouterAdapter {
  const base = opts.url.replace(/\/$/, '');
  const api = `${base}${opts.unifiOs ? '/proxy/network' : ''}/api/s/${opts.site}`;

  async function login(): Promise<Record<string, string>> {
    const res = await fetch(`${base}${opts.unifiOs ? '/api/auth/login' : '/api/login'}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: opts.username, password: opts.password }),
      // @ts-expect-error undici dispatcher is accepted by Node's fetch
      dispatcher: insecure,
    });
    if (!res.ok) throw new Error(`UniFi login failed (${res.status})`);
    const cookie = res.headers
      .getSetCookie()
      .map((c) => c.split(';')[0])
      .join('; ');
    const csrf = res.headers.get('x-csrf-token');
    return csrf ? { cookie, 'x-csrf-token': csrf } : { cookie };
  }

  async function get<T>(path: string, headers: Record<string, string>): Promise<T[]> {
    // @ts-expect-error undici dispatcher is accepted by Node's fetch
    const res = await fetch(`${api}${path}`, { headers, dispatcher: insecure });
    if (!res.ok) throw new Error(`UniFi ${path} failed (${res.status})`);
    return ((await res.json()) as { data: T[] }).data;
  }

  return {
    name: 'unifi',
    async fetchClients() {
      const headers = await login();
      const [infra, clients] = await Promise.all([get<any>('/stat/device', headers), get<any>('/stat/sta', headers)]);
      const out: RouterClient[] = [];
      for (const d of infra) {
        out.push({
          mac: normalizeMac(d.mac),
          ip: d.ip,
          name: d.name,
          model: d.model,
          kind: DEVICE_KINDS[d.type] ?? 'switch',
          online: d.state === 1,
          connection: {
            via: d.uplink?.uplink_mac ? normalizeMac(d.uplink.uplink_mac) : undefined,
            medium: d.uplink?.type === 'wireless' ? 'wifi' : 'wired',
          },
        });
      }
      for (const c of clients) {
        const parent = c.is_wired ? c.sw_mac : c.ap_mac;
        out.push({
          mac: normalizeMac(c.mac),
          ip: c.ip,
          hostname: c.hostname,
          name: c.name,
          online: true,
          connection: {
            via: parent ? normalizeMac(parent) : undefined,
            medium: c.is_wired ? 'wired' : 'wifi',
            ssid: c.essid,
            signal: c.signal,
            switchPort: c.sw_port,
          },
          traffic: { rxBytes: c.rx_bytes ?? 0, txBytes: c.tx_bytes ?? 0 },
        });
      }
      return out;
    },
  };
}
