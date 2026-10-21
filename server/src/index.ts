import http from 'node:http';
import path from 'node:path';
import { existsSync } from 'node:fs';
import { Scanner, type DeviceEdit } from './scanner.ts';
import { unifiAdapter } from './routers/unifi.ts';
import { openwrtAdapter } from './routers/openwrt.ts';
import type { RouterAdapter } from './types.ts';

const root = path.resolve(import.meta.dirname, '..');
if (existsSync(path.join(root, '.env'))) process.loadEnvFile(path.join(root, '.env'));

const env = process.env;
const PORT = Number(env.PORT ?? 4319);
const HOST = env.HOST ?? '127.0.0.1';
const SCAN_INTERVAL_MIN = Number(env.SCAN_INTERVAL_MIN ?? 5);

const routers: RouterAdapter[] = [];
if (env.UNIFI_URL && env.UNIFI_USERNAME && env.UNIFI_PASSWORD) {
  routers.push(
    unifiAdapter({
      url: env.UNIFI_URL,
      username: env.UNIFI_USERNAME,
      password: env.UNIFI_PASSWORD,
      site: env.UNIFI_SITE ?? 'default',
      unifiOs: env.UNIFI_OS !== 'false',
    }),
  );
}
if (env.OPENWRT_URL && env.OPENWRT_USERNAME && env.OPENWRT_PASSWORD) {
  routers.push(openwrtAdapter({ url: env.OPENWRT_URL, username: env.OPENWRT_USERNAME, password: env.OPENWRT_PASSWORD }));
}

const scanner = new Scanner(path.join(root, 'data'), routers, env.SCAN_INTERFACE);
await scanner.load();

function send(res: http.ServerResponse, status: number, body?: unknown) {
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': env.CORS_ORIGIN ?? '*',
    'access-control-allow-methods': 'GET, POST, PATCH, DELETE, OPTIONS',
    'access-control-allow-headers': 'content-type',
  });
  res.end(body === undefined ? undefined : JSON.stringify(body));
}

async function readJson<T>(req: http.IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString() || '{}') as T;
}

function startScan() {
  scanner.scan().catch((err) => console.error('Scan failed:', err));
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const deviceMatch = url.pathname.match(/^\/api\/devices\/([^/]+)$/);
  try {
    if (req.method === 'OPTIONS') return send(res, 204);
    if (req.method === 'GET' && url.pathname === '/api/snapshot') return send(res, 200, scanner.snapshot());
    if (req.method === 'POST' && url.pathname === '/api/scan') {
      startScan();
      return send(res, 202, { scanning: true });
    }
    if (req.method === 'PATCH' && deviceMatch) {
      const device = await scanner.edit(decodeURIComponent(deviceMatch[1]), await readJson<DeviceEdit>(req));
      return device ? send(res, 200, device) : send(res, 404, { error: 'Unknown device' });
    }
    if (req.method === 'DELETE' && deviceMatch) {
      return (await scanner.forget(decodeURIComponent(deviceMatch[1]))) ? send(res, 204) : send(res, 404, { error: 'Unknown device' });
    }
    send(res, 404, { error: 'Not found' });
  } catch (err) {
    send(res, 500, { error: String((err as Error).message ?? err) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`Network map scanner on http://${HOST}:${PORT}`);
  console.log(routers.length ? `Router sources: ${routers.map((r) => r.name).join(', ')}` : 'No router configured; using local scan only');
  startScan();
  if (SCAN_INTERVAL_MIN > 0) setInterval(startScan, SCAN_INTERVAL_MIN * 60_000);
});
