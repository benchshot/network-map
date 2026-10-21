import { normalizeMac } from '../discover.ts';
import type { RouterAdapter, RouterClient } from '../types.ts';

interface Options {
  url: string;
  username: string;
  password: string;
}

const ANONYMOUS = '00000000000000000000000000000000';

/** Reads clients over OpenWrt's ubus JSON-RPC. Needs the rpcd-mod-luci package (installed with LuCI). */
export function openwrtAdapter(opts: Options): RouterAdapter {
  const endpoint = `${opts.url.replace(/\/$/, '')}/ubus`;
  let id = 0;

  async function call(session: string, object: string, method: string, params: object = {}): Promise<any> {
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method: 'call', params: [session, object, method, params] }),
    });
    const body = (await res.json()) as { result?: [number, any]; error?: { message: string } };
    if (body.error) throw new Error(`OpenWrt ${object}.${method}: ${body.error.message}`);
    const [status, data] = body.result ?? [-1];
    if (status !== 0) throw new Error(`OpenWrt ${object}.${method} returned status ${status}`);
    return data;
  }

  return {
    name: 'openwrt',
    async fetchClients() {
      const { ubus_rpc_session: session } = await call(ANONYMOUS, 'session', 'login', {
        username: opts.username,
        password: opts.password,
      });
      const [hints, leases, wifi] = await Promise.all([
        call(session, 'luci-rpc', 'getHostHints'),
        call(session, 'luci-rpc', 'getDHCPLeases').catch(() => ({ dhcp_leases: [] })),
        call(session, 'luci-rpc', 'getWirelessDevices').catch(() => ({})),
      ]);

      const wifiClients = new Map<string, { ssid?: string; signal?: number }>();
      for (const radio of Object.values<any>(wifi)) {
        for (const iface of radio.interfaces ?? []) {
          const assoc = await call(session, 'iwinfo', 'assoclist', { device: iface.ifname }).catch(() => ({ results: [] }));
          for (const sta of assoc.results ?? []) {
            wifiClients.set(normalizeMac(sta.mac), { ssid: iface.iwinfo?.ssid ?? iface.config?.ssid, signal: sta.signal });
          }
        }
      }

      const byMac = new Map<string, RouterClient>();
      for (const [mac, hint] of Object.entries<any>(hints)) {
        const key = normalizeMac(mac);
        byMac.set(key, { mac: key, ip: hint.ipaddrs?.[0], hostname: hint.name, online: false });
      }
      for (const lease of leases.dhcp_leases ?? []) {
        const key = normalizeMac(lease.macaddr);
        const existing = byMac.get(key) ?? { mac: key, online: false };
        byMac.set(key, { ...existing, ip: lease.ipaddr ?? existing.ip, hostname: lease.hostname || existing.hostname });
      }
      for (const client of byMac.values()) {
        const wireless = wifiClients.get(client.mac);
        client.online = Boolean(wireless);
        client.connection = wireless ? { medium: 'wifi', ...wireless } : { medium: 'unknown' };
      }
      return [...byMac.values()];
    },
  };
}
