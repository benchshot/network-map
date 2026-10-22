import type { Device, Finding, Severity, UpnpStatus } from './types.ts';

interface ServiceRisk {
  severity: Severity;
  title: string;
  detail: string;
  fix: string;
}

const DATABASE: Omit<ServiceRisk, 'title'> = {
  severity: 'high',
  detail: 'Databases like this often ship with no password and are a common target for ransomware bots. Anything on your network can try to read or wipe it.',
  fix: 'Bind it to localhost (127.0.0.1) or put it behind a firewall, and turn on authentication.',
};

/** Services that are risky just by being reachable. SSH, HTTPS and the like are fine on a LAN and not listed. */
export const SERVICE_RISKS: Record<number, ServiceRisk> = {
  23: {
    severity: 'high',
    title: 'Telnet is open',
    detail: 'Telnet sends usernames and passwords in plain text, and it is the main way IoT botnets like Mirai take over devices.',
    fix: 'Turn Telnet off in the device settings, or update its firmware. Use SSH if you need remote access.',
  },
  21: {
    severity: 'medium',
    title: 'FTP is open',
    detail: 'FTP sends logins and files unencrypted, so anyone on the network can read them.',
    fix: 'Switch to SFTP or SMB, or turn the FTP server off if you don’t use it.',
  },
  2375: {
    severity: 'critical',
    title: 'Docker API is open without encryption',
    detail: 'Anyone who can reach this port can start containers with full control of the machine, with no password.',
    fix: 'Stop exposing the Docker daemon on TCP 2375. Use the local socket, or TLS on 2376.',
  },
  5555: {
    severity: 'high',
    title: 'Android debugging (ADB) is open',
    detail: 'ADB over the network gives full control of the device: installing apps, reading files and running commands.',
    fix: 'Turn off “Wireless debugging” / “ADB over network” in Developer options.',
  },
  6379: { ...DATABASE, title: 'Redis is reachable on the network' },
  27017: { ...DATABASE, title: 'MongoDB is reachable on the network' },
  9200: { ...DATABASE, title: 'Elasticsearch is reachable on the network' },
  11211: { ...DATABASE, title: 'Memcached is reachable on the network' },
  3306: {
    severity: 'medium',
    title: 'MySQL is reachable on the network',
    detail: 'The database accepts connections from other devices. That’s fine if it’s intended and protected by a strong password.',
    fix: 'Bind it to localhost unless other machines need it, and use strong passwords.',
  },
  5432: {
    severity: 'medium',
    title: 'PostgreSQL is reachable on the network',
    detail: 'The database accepts connections from other devices. That’s fine if it’s intended and protected by a strong password.',
    fix: 'Bind it to localhost unless other machines need it, and check pg_hba.conf requires passwords.',
  },
  3389: {
    severity: 'medium',
    title: 'Remote Desktop is open',
    detail: 'RDP is a frequent target for password guessing and has had serious bugs. It’s fine on a home network if you use it and keep it updated.',
    fix: 'Turn it off if you don’t use it. Never forward it to the internet; use a VPN instead.',
  },
  5900: {
    severity: 'medium',
    title: 'Screen sharing (VNC) is open',
    detail: 'Anyone on the network can try to log in and see or control the screen. Many VNC servers use weak 8-character passwords.',
    fix: 'Turn screen sharing off when you don’t need it, or limit it to specific users.',
  },
  1883: {
    severity: 'medium',
    title: 'MQTT broker is open without encryption',
    detail: 'Smart-home messages travel unencrypted, and many brokers allow anyone to connect and send commands.',
    fix: 'Require a username and password on the broker, or use TLS on port 8883.',
  },
  554: {
    severity: 'low',
    title: 'Camera video stream is reachable',
    detail: 'The RTSP stream may be viewable by anything on the network, sometimes without a password.',
    fix: 'Make sure the camera has a strong, non-default password, and keep its firmware updated.',
  },
  445: {
    severity: 'low',
    title: 'File sharing (SMB) is on',
    detail: 'Shared folders are visible to the network. That’s expected on a computer or NAS, but unusual on anything else.',
    fix: 'Check which folders are shared, and turn file sharing off if you don’t use it.',
  },
};

/** How the risk changes once a handshake tells us whether the service asks for credentials. */
const AUTH_RISKS: Record<number, Record<'none' | 'required', Partial<ServiceRisk>>> = {
  5555: {
    none: {
      severity: 'critical',
      title: 'Android debugging (ADB) is open with no approval needed',
      detail: 'Anyone on the network can connect and get full control of this device: install apps, read files, run commands.',
    },
    required: {
      severity: 'low',
      title: 'Android debugging (ADB) is on',
      detail:
        'Network debugging is switched on, but each new computer has to be approved on the device’s screen first. Usually left over from sideloading an app.',
    },
  },
  6379: {
    none: { severity: 'critical', title: 'Redis is open with no password', detail: 'Anyone on the network can read, change or wipe everything in it, and often take over the machine.' },
    required: { severity: 'medium', title: 'Redis is reachable on the network', detail: 'It asks for a password, but databases are still safer bound to localhost.' },
  },
};

const LOGIN_TITLE = /log ?in|sign ?in|admin|router|portainer|home assistant|open ?webui|synology|unifi|pi-hole|grafana|jupyter|proxmox|truenas|webmin|cockpit/i;

function finding(f: Omit<Finding, 'id' | 'accepted'>, accepted: string[]): Finding {
  const id = `${f.deviceId ?? 'network'}|${f.key}`;
  return { ...f, id, accepted: accepted.includes(f.key) };
}

/** Builds the list of findings from what the scan already knows. Pure, so it runs on every snapshot. */
export function assess(devices: Device[], upnp: UpnpStatus | undefined, gatewayId?: string): Finding[] {
  const findings: Finding[] = [];
  const byIp = new Map(devices.filter((d) => d.ip).map((d) => [d.ip!, d]));

  // Only online devices had their ports checked in the latest scan.
  for (const d of devices.filter((d) => d.online)) {
    const accepted = d.acceptedFindings ?? [];
    for (const p of d.ports) {
      const base = SERVICE_RISKS[p.port];
      const risk = base && p.auth ? { ...base, ...AUTH_RISKS[p.port]?.[p.auth] } : base;
      if (risk) findings.push(finding({ deviceId: d.id, key: `port:${p.port}`, category: 'service', port: p.port, ...risk }, accepted));

      if (p.web && !p.web.https && (p.web.login || (p.title && LOGIN_TITLE.test(p.title)) || d.id === gatewayId)) {
        const what = d.id === gatewayId ? 'The router’s admin page' : p.title ? `“${p.title}”` : `The web page on port ${p.port}`;
        findings.push(
          finding(
            {
              deviceId: d.id,
              key: `http-login:${p.port}`,
              category: 'web',
              port: p.port,
              severity: 'medium',
              title: 'Login page without encryption',
              detail: `${what} is served over plain HTTP, so the password you type travels unencrypted and can be read by anything on the network.`,
              fix: 'Turn on HTTPS in the app’s settings if it has it, or put it behind a reverse proxy with a certificate (Caddy, Nginx Proxy Manager, Tailscale Serve).',
            },
            accepted,
          ),
        );
      }
    }
  }

  if (upnp?.available) {
    const gateway = gatewayId ? devices.find((d) => d.id === gatewayId) : undefined;
    const behindNat = upnp.externalIp ? isPrivate(upnp.externalIp) : false;

    findings.push(
      finding(
        {
          deviceId: gateway?.id,
          key: 'upnp-enabled',
          category: 'internet',
          severity: 'low',
          title: 'UPnP is turned on',
          detail:
            'Any app or device on your network can ask the router to open a port to the internet, without asking you. Malware uses this to make infected devices reachable.',
          fix: 'Turn UPnP off in the router settings. Game consoles may want it; if so, forward only the ports they need by hand.',
        },
        gateway?.acceptedFindings ?? [],
      ),
    );

    for (const m of upnp.mappings.filter((m) => m.enabled)) {
      const target = byIp.get(m.internalClient);
      const holder = target ?? gateway;
      const risk = SERVICE_RISKS[m.internalPort];
      const dangerous = risk || [22, 80, 8080, 445, 139].includes(m.internalPort);
      const who = target ? 'this device' : m.internalClient || 'an unknown device';
      findings.push(
        finding(
          {
            deviceId: holder?.id,
            key: `upnp:${m.protocol}:${m.externalPort}`,
            category: 'internet',
            port: m.internalPort,
            severity: behindNat ? 'low' : dangerous ? 'critical' : 'high',
            title: `Port ${m.externalPort}/${m.protocol} is open to the internet`,
            detail:
              `${m.description ? `“${m.description}” asked` : 'Something asked'} the router to forward ${m.protocol} port ${m.externalPort} from the internet to ${who} (port ${m.internalPort})` +
              `${m.leaseSeconds ? '' : ', and the mapping never expires'}. Anyone on the internet can reach it.` +
              (behindNat ? ` Your router itself sits behind another router (its internet address ${upnp.externalIp} is private), so this probably isn’t reachable from outside yet.` : ''),
            fix: risk
              ? `${risk.fix} Then remove the mapping, ideally by turning UPnP off.`
              : 'If you don’t recognise the app, find and remove it. Otherwise turn UPnP off and forward only what you need by hand.',
          },
          holder?.acceptedFindings ?? [],
        ),
      );
    }
  }

  const order: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3 };
  return findings.sort((a, b) => Number(a.accepted) - Number(b.accepted) || order[a.severity] - order[b.severity]);
}

function isPrivate(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  return a === 10 || (a === 172 && b >= 16 && b < 32) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b < 128);
}
