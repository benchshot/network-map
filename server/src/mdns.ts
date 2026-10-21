import makeMdns from 'multicast-dns';

export interface MdnsHost {
  hostname?: string;
  friendlyName?: string;
  model?: string;
  /** Some hosts (Linux _workstation, for one) put their MAC in the instance name. */
  mac?: string;
  services: Set<string>;
}

const SERVICE_LABELS: Record<string, string> = {
  _airplay: 'AirPlay',
  _raop: 'AirPlay audio',
  _googlecast: 'Chromecast',
  _hap: 'HomeKit',
  _homekit: 'HomeKit',
  _matter: 'Matter',
  _matterc: 'Matter',
  _ipp: 'Printer',
  _ipps: 'Printer',
  _printer: 'Printer',
  _pdl_datastream: 'Printer',
  _scanner: 'Scanner',
  _uscan: 'Scanner',
  _smb: 'File sharing',
  _afpovertcp: 'File sharing',
  _adisk: 'Time Machine',
  _companion_link: 'Apple device',
  _rdlink: 'Apple device',
  _sleep_proxy: 'Sleep proxy',
  _spotify_connect: 'Spotify Connect',
  _sonos: 'Sonos',
  _ssh: 'SSH',
  _sftp_ssh: 'SFTP',
  _http: 'Web',
  _https: 'Web',
  _home_assistant: 'Home Assistant',
  _hue: 'Philips Hue',
  _huesync: 'Hue Sync',
  _matterd: 'Matter',
  _remotepairing: 'Apple device',
  _apple_mobdev2: 'Apple device',
  _airport: 'AirPort',
  _esphomelib: 'ESPHome',
  _mqtt: 'MQTT',
  _amzn_wplay: 'Amazon Echo',
  _androidtvremote2: 'Android TV',
  _meshcop: 'Thread border router',
  _trel: 'Thread',
  _workstation: 'Workstation',
  _device_info: '',
};

/** Only well-known services; vendor-private types (random IDs, internal daemons) are noise. */
function serviceLabel(type: string): string {
  return SERVICE_LABELS[type.split('.')[0].replace(/-/g, '_')] ?? '';
}

function txtValue(data: unknown, key: string): string | undefined {
  const entries = Array.isArray(data) ? data : [data];
  for (const entry of entries) {
    const text = Buffer.isBuffer(entry) ? entry.toString() : String(entry);
    if (text.startsWith(`${key}=`)) return text.slice(key.length + 1);
  }
  return undefined;
}

/** Listens for Bonjour/mDNS answers for a few seconds and groups what each IP advertises. */
export function browseMdns(durationMs = 5000): Promise<Map<string, MdnsHost>> {
  return new Promise((resolve) => {
    const hosts = new Map<string, MdnsHost>();
    const queried = new Set<string>();
    let mdns: ReturnType<typeof makeMdns>;
    try {
      mdns = makeMdns();
    } catch {
      resolve(hosts);
      return;
    }

    const hostFor = (ip: string) => {
      let host = hosts.get(ip);
      if (!host) {
        host = { services: new Set() };
        hosts.set(ip, host);
      }
      return host;
    };

    mdns.on('response', (response, rinfo) => {
      if (!/^\d+\.\d+\.\d+\.\d+$/.test(rinfo.address)) return;
      const records = [...response.answers, ...(response.additionals ?? [])];
      for (const record of records) {
        if (record.type === 'A' && typeof record.data === 'string') {
          hostFor(record.data).hostname ??= record.name.replace(/\.local$/, '');
        }
      }
      const sender = hostFor(rinfo.address);
      for (const record of records) {
        if (record.type === 'PTR' && typeof record.data === 'string') {
          if (record.name === '_services._dns-sd._udp.local') {
            if (!queried.has(record.data)) {
              queried.add(record.data);
              mdns.query({ questions: [{ name: record.data, type: 'PTR' }] });
            }
            continue;
          }
          // Reverse-lookup PTRs (in-addr.arpa) share the record type but aren't services.
          if (!/\._(tcp|udp)\.local$/.test(record.name) || !record.data.endsWith(`.${record.name}`)) continue;
          const label = serviceLabel(record.name);
          if (label) sender.services.add(label);
          const instance = record.data.slice(0, record.data.length - record.name.length - 1);
          const mac = instance.match(/\[((?:[0-9a-f]{2}:){5}[0-9a-f]{2})\]/i)?.[1];
          if (mac) sender.mac ??= mac.toLowerCase();
          const friendly = instance
            .replace(/^[0-9a-f]{12}@/i, '')
            .replace(/\s*\[[0-9a-f:]{17}\]$/i, '')
            .trim();
          const looksGenerated = /^[0-9a-f-]{12,}$/i.test(friendly) || /[0-9a-f]{16,}/i.test(friendly);
          if (friendly && !looksGenerated && !record.name.startsWith('_device-info') && !record.name.startsWith('_sleep-proxy')) {
            sender.friendlyName ??= friendly;
          }
        }
        if (record.type === 'SRV' && record.data && typeof record.data === 'object' && 'target' in record.data) {
          const target = String(record.data.target).replace(/\.local$/, '');
          if (target && target !== 'none') sender.hostname ??= target;
        }
        if (record.type === 'TXT' && record.name.includes('_device-info')) {
          sender.model ??= txtValue(record.data, 'model');
        }
      }
    });

    mdns.query({ questions: [{ name: '_services._dns-sd._udp.local', type: 'PTR' }] });
    setTimeout(() => {
      mdns.destroy();
      for (const [ip, host] of hosts) if (!host.services.size && !host.hostname) hosts.delete(ip);
      resolve(hosts);
    }, durationMs);
  });
}
