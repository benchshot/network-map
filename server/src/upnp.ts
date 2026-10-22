import dgram from 'node:dgram';
import type { PortMapping, UpnpStatus } from './types.ts';

const SSDP_ADDRESS = '239.255.255.250';
const SSDP_PORT = 1900;
const WAN_SERVICES = /urn:schemas-upnp-org:service:WAN(IP|PPP)Connection:\d/;

/** Sends an SSDP search and collects the LOCATION header of every gateway that answers. */
function discoverGateways(timeoutMs: number): Promise<string[]> {
  return new Promise((resolve) => {
    const socket = dgram.createSocket({ type: 'udp4', reuseAddr: true });
    const locations = new Set<string>();
    const finish = () => {
      socket.close();
      resolve([...locations]);
    };
    socket.on('message', (msg) => {
      const location = msg.toString().match(/^location:\s*(\S+)/im)?.[1];
      if (location) locations.add(location);
    });
    socket.on('error', finish);
    socket.bind(() => {
      for (const target of ['urn:schemas-upnp-org:device:InternetGatewayDevice:1', 'urn:schemas-upnp-org:device:InternetGatewayDevice:2']) {
        const search = [
          'M-SEARCH * HTTP/1.1',
          `HOST: ${SSDP_ADDRESS}:${SSDP_PORT}`,
          'MAN: "ssdp:discover"',
          'MX: 2',
          `ST: ${target}`,
          '',
          '',
        ].join('\r\n');
        socket.send(search, SSDP_PORT, SSDP_ADDRESS);
      }
      setTimeout(finish, timeoutMs);
    });
  });
}

function tag(xml: string, name: string): string | undefined {
  return xml.match(new RegExp(`<(?:\\w+:)?${name}>([^<]*)</(?:\\w+:)?${name}>`, 'i'))?.[1].trim();
}

/** Finds the WAN connection service in a device description and returns its control URL. */
async function wanService(location: string): Promise<{ controlUrl: string; serviceType: string } | undefined> {
  const res = await fetch(location, { signal: AbortSignal.timeout(3000) });
  const xml = await res.text();
  for (const block of xml.match(/<service>[\s\S]*?<\/service>/gi) ?? []) {
    const serviceType = tag(block, 'serviceType');
    const control = tag(block, 'controlURL');
    if (serviceType && control && WAN_SERVICES.test(serviceType)) {
      return { controlUrl: new URL(control, location).toString(), serviceType };
    }
  }
  return undefined;
}

async function soap(controlUrl: string, serviceType: string, action: string, args: Record<string, string | number> = {}) {
  const body =
    '<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/" s:encodingStyle="http://schemas.xmlsoap.org/soap/encoding/">' +
    `<s:Body><u:${action} xmlns:u="${serviceType}">` +
    Object.entries(args)
      .map(([k, v]) => `<${k}>${v}</${k}>`)
      .join('') +
    `</u:${action}></s:Body></s:Envelope>`;
  const res = await fetch(controlUrl, {
    method: 'POST',
    headers: { 'content-type': 'text/xml; charset="utf-8"', soapaction: `"${serviceType}#${action}"` },
    body,
    signal: AbortSignal.timeout(3000),
  });
  return { ok: res.ok, xml: await res.text() };
}

/** Reads the external address and every port mapping from one gateway's description URL. */
export async function queryGateway(location: string, checkedAt = new Date().toISOString()): Promise<UpnpStatus | undefined> {
  const service = await wanService(location).catch(() => undefined);
  if (!service) return undefined;
  const external = await soap(service.controlUrl, service.serviceType, 'GetExternalIPAddress').catch(() => undefined);
  const mappings: PortMapping[] = [];
  for (let index = 0; index < 256; index++) {
    const entry = await soap(service.controlUrl, service.serviceType, 'GetGenericPortMappingEntry', {
      NewPortMappingIndex: index,
    }).catch(() => undefined);
    if (!entry?.ok) break;
    const externalPort = Number(tag(entry.xml, 'NewExternalPort'));
    if (!externalPort) break;
    mappings.push({
      externalPort,
      internalPort: Number(tag(entry.xml, 'NewInternalPort')) || externalPort,
      protocol: (tag(entry.xml, 'NewProtocol') ?? 'TCP').toUpperCase() === 'UDP' ? 'UDP' : 'TCP',
      internalClient: tag(entry.xml, 'NewInternalClient') ?? '',
      description: tag(entry.xml, 'NewPortMappingDescription') || undefined,
      enabled: tag(entry.xml, 'NewEnabled') !== '0',
      leaseSeconds: Number(tag(entry.xml, 'NewLeaseDuration')) || 0,
    });
  }
  return {
    available: true,
    gateway: new URL(location).hostname,
    externalIp: external?.ok ? tag(external.xml, 'NewExternalIPAddress') : undefined,
    mappings,
    checkedAt,
  };
}

/**
 * Asks the router (read-only) which ports apps have opened to the internet through UPnP.
 * Never adds or removes a mapping.
 */
export async function readUpnp(timeoutMs = 2500): Promise<UpnpStatus> {
  const checkedAt = new Date().toISOString();
  try {
    for (const location of await discoverGateways(timeoutMs)) {
      const status = await queryGateway(location, checkedAt);
      if (status) return status;
    }
    return { available: false, mappings: [], checkedAt };
  } catch (err) {
    return { available: false, mappings: [], checkedAt, error: String((err as Error).message ?? err) };
  }
}
