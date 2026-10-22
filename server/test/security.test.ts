import { test } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { assess } from '../src/security.ts';
import { queryGateway } from '../src/upnp.ts';
import { httpProbe } from '../src/discover.ts';
import type { Device, OpenPort, UpnpStatus } from '../src/types.ts';

function device(id: string, ip: string, ports: OpenPort[] = [], extra: Partial<Device> = {}): Device {
  return {
    id,
    ip,
    mac: id,
    randomizedMac: false,
    kind: 'unknown',
    kindSetByUser: false,
    ports,
    mdnsServices: [],
    connection: { medium: 'unknown' },
    online: true,
    isSelf: false,
    firstSeen: '2026-01-01T00:00:00.000Z',
    lastSeen: '2026-01-01T00:00:00.000Z',
    acknowledged: true,
    sources: ['scan'],
    ...extra,
  };
}

async function serve(handler: http.RequestListener): Promise<{ url: string; close(): void }> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${port}`, close: () => server.close() };
}

test('risky services become findings, ordinary ones do not', () => {
  const findings = assess(
    [device('a', '192.168.1.10', [{ port: 22, service: 'SSH' }, { port: 23, service: 'Telnet' }, { port: 2375, service: 'Docker API' }])],
    undefined,
  );
  assert.deepEqual(
    findings.map((f) => [f.key, f.severity]),
    [
      ['port:2375', 'critical'],
      ['port:23', 'high'],
    ],
  );
});

test('login pages over plain HTTP are flagged, HTTPS redirects are not', () => {
  const findings = assess(
    [
      device('a', '192.168.1.10', [{ port: 8080, service: 'HTTP alt', title: 'Open WebUI', web: { https: false, login: false } }]),
      device('b', '192.168.1.11', [{ port: 80, service: 'HTTP', web: { https: false, login: true } }]),
      device('c', '192.168.1.12', [{ port: 80, service: 'HTTP', title: 'Login', web: { https: true, login: false } }]),
      device('d', '192.168.1.13', [{ port: 80, service: 'HTTP', title: 'Printer status', web: { https: false, login: false } }]),
      device('gw', '192.168.1.1', [{ port: 80, service: 'HTTP', web: { https: false, login: false } }]),
    ],
    undefined,
    'gw',
  );
  assert.deepEqual(findings.map((f) => f.id).sort(), ['a|http-login:8080', 'b|http-login:80', 'gw|http-login:80']);
});

test('handshake results change how serious ADB and Redis are', () => {
  const findings = assess(
    [
      device('tv', '192.168.1.20', [{ port: 5555, service: 'Android ADB', auth: 'required' }]),
      device('box', '192.168.1.21', [{ port: 5555, service: 'Android ADB', auth: 'none' }]),
      device('db', '192.168.1.22', [{ port: 6379, service: 'Redis' }]),
      device('old', '192.168.1.23', [{ port: 23, service: 'Telnet' }], { online: false }),
    ],
    undefined,
  );
  assert.deepEqual(
    findings.map((f) => [f.id, f.severity]),
    [
      ['box|port:5555', 'critical'],
      ['db|port:6379', 'high'],
      ['tv|port:5555', 'low'],
    ],
  );
});

test('accepted findings are kept but marked and sorted last', () => {
  const findings = assess(
    [
      device('a', '192.168.1.10', [{ port: 2375, service: 'Docker API' }], { acceptedFindings: ['port:2375'] }),
      device('b', '192.168.1.11', [{ port: 445, service: 'SMB' }]),
    ],
    undefined,
  );
  assert.deepEqual(
    findings.map((f) => [f.id, f.accepted]),
    [
      ['b|port:445', false],
      ['a|port:2375', true],
    ],
  );
});

test('UPnP mappings to the internet are rated by what they expose', () => {
  const upnp: UpnpStatus = {
    available: true,
    externalIp: '203.0.113.5',
    checkedAt: '',
    mappings: [
      { externalPort: 2222, internalPort: 22, protocol: 'TCP', internalClient: '192.168.1.10', enabled: true, leaseSeconds: 0 },
      { externalPort: 3074, internalPort: 3074, protocol: 'UDP', internalClient: '192.168.1.11', enabled: true, leaseSeconds: 3600, description: 'Xbox' },
      { externalPort: 9999, internalPort: 9999, protocol: 'TCP', internalClient: '192.168.1.99', enabled: true, leaseSeconds: 0 },
      { externalPort: 1, internalPort: 1, protocol: 'TCP', internalClient: '192.168.1.10', enabled: false, leaseSeconds: 0 },
    ],
  };
  const findings = assess([device('gw', '192.168.1.1'), device('a', '192.168.1.10'), device('b', '192.168.1.11')], upnp, 'gw');
  assert.deepEqual(
    findings.map((f) => [f.id, f.severity]),
    [
      ['a|upnp:TCP:2222', 'critical'],
      ['b|upnp:UDP:3074', 'high'],
      ['gw|upnp:TCP:9999', 'high'],
      ['gw|upnp-enabled', 'low'],
    ],
  );
});

test('mappings behind a second router are downgraded', () => {
  const upnp: UpnpStatus = {
    available: true,
    externalIp: '192.168.100.2',
    checkedAt: '',
    mappings: [{ externalPort: 2222, internalPort: 22, protocol: 'TCP', internalClient: '192.168.1.10', enabled: true, leaseSeconds: 0 }],
  };
  const mapping = assess([device('a', '192.168.1.10')], upnp).find((f) => f.key === 'upnp:TCP:2222')!;
  assert.equal(mapping.severity, 'low');
  assert.match(mapping.detail, /behind another router/);
});

test('queryGateway reads every mapping from a UPnP router', async () => {
  const mappings = [
    { ext: 2222, int: 22, proto: 'TCP', client: '192.168.1.10', desc: 'ssh', enabled: 1, lease: 0 },
    { ext: 3074, int: 3074, proto: 'UDP', client: '192.168.1.11', desc: 'Xbox', enabled: 1, lease: 3600 },
  ];
  const actions: string[] = [];
  const router = await serve((req, res) => {
    if (req.url === '/rootDesc.xml') {
      res.end(`<root><device><deviceList><device><serviceList><service>
        <serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType>
        <controlURL>/ctl/IPConn</controlURL></service></serviceList></device></deviceList></device></root>`);
      return;
    }
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const action = String(req.headers.soapaction).split('#')[1].replace('"', '');
      actions.push(action);
      if (action === 'AddPortMapping' || action === 'DeletePortMapping') throw new Error('must stay read-only');
      if (action === 'GetExternalIPAddress') {
        res.end('<s:Envelope><s:Body><u:R><NewExternalIPAddress>203.0.113.5</NewExternalIPAddress></u:R></s:Body></s:Envelope>');
        return;
      }
      const index = Number(body.match(/<NewPortMappingIndex>(\d+)</)?.[1]);
      const m = mappings[index];
      if (!m) {
        res.statusCode = 500;
        res.end('<s:Envelope><s:Body><s:Fault><detail><UPnPError><errorCode>713</errorCode></UPnPError></detail></s:Fault></s:Body></s:Envelope>');
        return;
      }
      res.end(
        `<s:Envelope><s:Body><u:R><NewRemoteHost></NewRemoteHost><NewExternalPort>${m.ext}</NewExternalPort><NewProtocol>${m.proto}</NewProtocol>` +
          `<NewInternalPort>${m.int}</NewInternalPort><NewInternalClient>${m.client}</NewInternalClient><NewEnabled>${m.enabled}</NewEnabled>` +
          `<NewPortMappingDescription>${m.desc}</NewPortMappingDescription><NewLeaseDuration>${m.lease}</NewLeaseDuration></u:R></s:Body></s:Envelope>`,
      );
    });
  });
  try {
    const status = await queryGateway(`${router.url}/rootDesc.xml`, 'now');
    assert.equal(status?.externalIp, '203.0.113.5');
    assert.deepEqual(status?.mappings, [
      { externalPort: 2222, internalPort: 22, protocol: 'TCP', internalClient: '192.168.1.10', description: 'ssh', enabled: true, leaseSeconds: 0 },
      { externalPort: 3074, internalPort: 3074, protocol: 'UDP', internalClient: '192.168.1.11', description: 'Xbox', enabled: true, leaseSeconds: 3600 },
    ]);
    assert.ok(actions.every((a) => a.startsWith('Get')));
  } finally {
    router.close();
  }
});

test('httpProbe spots password forms, 401s and HTTPS redirects', async () => {
  const site = await serve((req, res) => {
    if (req.url === '/') {
      res.end('<html><title>Admin</title><form><input name="p" type="password"></form></html>');
      return;
    }
    res.end();
  });
  const router = await serve((req, res) => {
    if (req.url === '/') {
      res.end('<meta http-equiv="refresh" content="0; URL=/webpages/login.html" />');
      return;
    }
    res.end('<html><script src="app.js"></script></html>');
  });
  const scripted = await serve((_req, res) => {
    res.end('<noscript><meta http-equiv="refresh" content="0; url=error.html"/></noscript><input id="login-password" name="password">');
  });
  const redirect = await serve((_req, res) => {
    res.writeHead(301, { location: 'https://example.invalid/' });
    res.end();
  });
  const digest = await serve((_req, res) => {
    res.writeHead(401, { 'www-authenticate': 'Digest realm="tv", qop="auth", nonce="1"' });
    res.end();
  });
  const basic = await serve((_req, res) => {
    res.writeHead(401, { 'www-authenticate': 'Basic realm="cam"' });
    res.end();
  });
  try {
    const port = (url: string) => Number(new URL(url).port);
    assert.deepEqual(await httpProbe('127.0.0.1', port(site.url)), { title: 'Admin', https: false, login: true });
    assert.deepEqual(await httpProbe('127.0.0.1', port(redirect.url)), { title: undefined, https: true, login: false });
    assert.deepEqual(await httpProbe('127.0.0.1', port(basic.url)), { title: undefined, https: false, login: true });
    assert.deepEqual(await httpProbe('127.0.0.1', port(digest.url)), { title: undefined, https: false, login: false });
    assert.deepEqual(await httpProbe('127.0.0.1', port(router.url)), { title: undefined, https: false, login: true });
    assert.deepEqual(await httpProbe('127.0.0.1', port(scripted.url)), { title: undefined, https: false, login: true });
  } finally {
    site.close();
    redirect.close();
    basic.close();
    digest.close();
    router.close();
    scripted.close();
  }
});
