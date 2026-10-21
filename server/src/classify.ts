import type { Device, DeviceKind } from './types.ts';

const VENDOR_RULES: [RegExp, DeviceKind][] = [
  [/sonos|bose|harman|bang & olufsen|denon|yamaha/i, 'speaker'],
  [/roku|vizio|tcl|hisense|lg electronics|samsung electronics|sony|nvidia/i, 'tv'],
  [/hikvision|dahua|reolink|amcrest|wyze|arlo|axis comm|ring/i, 'camera'],
  [/brother|canon|epson|hewlett|lexmark|xerox|kyocera/i, 'printer'],
  [/espressif|tuya|shelly|lifx|signify|philips lighting|ecobee|nest|ikea|sengled|wiz|meross|tp-link.*kasa|amazon|google/i, 'iot'],
  [/synology|qnap|western digital|buffalo|asustor/i, 'nas'],
  [/nintendo|sony interactive|microsoft.*xbox/i, 'console'],
  [/raspberry pi/i, 'server'],
  [/ubiquiti|netgear|tp-link|asus|linksys|eero|mikrotik|cisco|aruba|d-link|zyxel|arris|technicolor/i, 'ap'],
];

const NAME_RULES: [RegExp, DeviceKind][] = [
  [/iphone|pixel|galaxy-?s|android|oneplus|phone/i, 'phone'],
  [/ipad|tablet|kindle|fire-?hd/i, 'tablet'],
  [/macbook|imac|mac-?mini|mac-?studio|desktop|laptop|-pc\b|windows|thinkpad|surface/i, 'computer'],
  [/apple-?tv|roku|chromecast|firetv|fire-tv|shield|bravia|tv\b/i, 'tv'],
  [/sonos|homepod|echo|nest-?(mini|audio)|speaker/i, 'speaker'],
  [/printer|epson|brother|canon|hp[0-9a-f]{6}/i, 'printer'],
  [/cam|doorbell/i, 'camera'],
  [/nas|synology|diskstation|truenas|unraid/i, 'nas'],
  [/server|pi\b|raspberry|proxmox|docker|homelab/i, 'server'],
  [/switch|xbox|playstation|ps5|ps4/i, 'console'],
];

const SERVICE_RULES: [string, DeviceKind][] = [
  ['Printer', 'printer'],
  ['Chromecast', 'tv'],
  ['Android TV', 'tv'],
  ['Sonos', 'speaker'],
  ['Amazon Echo', 'speaker'],
  ['Time Machine', 'nas'],
  ['Home Assistant', 'server'],
  ['HomeKit', 'iot'],
  ['Philips Hue', 'iot'],
  ['Hue Sync', 'iot'],
  ['AirPort', 'ap'],
  ['Matter', 'iot'],
  ['ESPHome', 'iot'],
];

const PORT_RULES: [number, DeviceKind][] = [
  [631, 'printer'],
  [9100, 'printer'],
  [554, 'camera'],
  [1400, 'speaker'],
  [5001, 'nas'],
  [8123, 'server'],
  [32400, 'server'],
  [8008, 'tv'],
  [62078, 'phone'],
];

const MODEL_RULES: [RegExp, DeviceKind][] = [
  [/^(Mac|iMac|MacBook)/, 'computer'],
  [/^(AppleTV|J\d+AP)/, 'tv'],
  [/^(AudioAccessory|HomePod)/, 'speaker'],
  [/^iPhone/, 'phone'],
  [/^iPad/, 'tablet'],
];

/** Best guess at what a device is, from everything we've learned about it. */
export function guessKind(device: Device, gatewayIp?: string): DeviceKind {
  if (device.ip && device.ip === gatewayIp) return 'gateway';
  for (const [pattern, kind] of MODEL_RULES) if (pattern.test(device.model ?? '')) return kind;
  for (const [service, kind] of SERVICE_RULES) if (device.mdnsServices.includes(service)) return kind;
  const name = [device.hostname, device.advertisedName].filter(Boolean).join(' ');
  for (const [pattern, kind] of NAME_RULES) if (pattern.test(name)) return kind;
  const ports = new Set(device.ports.map((p) => p.port));
  for (const [port, kind] of PORT_RULES) if (ports.has(port)) return kind;
  if (device.mdnsServices.includes('Apple device')) return device.randomizedMac ? 'phone' : 'computer';
  if (ports.has(22) && ports.size >= 3) return 'server';
  if (ports.has(5555)) return 'iot';
  if (ports.has(3389) || ports.has(445)) return 'computer';
  for (const [pattern, kind] of VENDOR_RULES) if (pattern.test(device.vendor ?? '')) return kind;
  if (device.mdnsServices.includes('Spotify Connect')) return 'speaker';
  if (device.randomizedMac) return 'phone';
  return 'unknown';
}
