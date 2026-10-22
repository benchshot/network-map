# Network Map

A live map of everything on your home network: what each device is, what it's running, what it's connected to, and when something new shows up.

It runs entirely on your own machine. Nothing is sent anywhere, there's no account, and the scanner only reads from the network.

| Path | What it is |
| --- | --- |
| `server/` | The scanner: a small Node + TypeScript service (no build step, Node ≥ 23 runs the `.ts` directly). It pings the subnet, reads the ARP table, listens for Bonjour/mDNS, probes common ports, optionally asks the router, and serves `/api/*`. State lives in `server/data/devices.json` |
| `app/` | The UI: Expo / React Native + TypeScript, run as a web app. Collapsible tree and radial maps (d3-hierarchy + react-native-svg), searchable device list, editable detail panel |

## Requirements

- **Node.js 23.6 or newer** (the scanner runs TypeScript directly, with no build step)
- **macOS or Linux** on the same network you want to map. Windows isn't supported yet (ARP and interface discovery are macOS/Linux specific).
- A modern browser for the UI

## Run it

```sh
git clone https://github.com/benchshot/network-map.git
cd network-map
```


```sh
npm run setup     # installs both halves
npm run scanner   # http://127.0.0.1:4319, rescans every 5 min
npm run web       # http://localhost:8081
```

The scanner has to run on a machine on the network you want to map (a laptop, a home server, a Raspberry Pi), because a browser can't scan a network on its own. Everything it learns, including your names and notes, is stored in `server/data/devices.json`, which is git-ignored.

Only scan networks you own or have permission to scan.

### macOS: allow Local Network access

macOS hides ARP entries and MAC addresses from processes that don't have Local Network permission. Without it, devices are tracked by IP, vendors are unknown, and the app shows a banner. Grant it in **System Settings → Privacy & Security → Local Network** for the terminal app you start the scanner from, then restart the scanner. Devices that were tracked by IP move to their MAC automatically and keep your names and notes.

## Router data (optional)

Copy `server/.env.example` to `server/.env` and fill in a router. With one configured you also get real topology (which switch port or access point each device hangs off), Wi-Fi SSID and signal, and traffic counters.

- **UniFi** (UDM, UCG, Cloud Key, self-hosted Network app): `UNIFI_URL`, `UNIFI_USERNAME`, `UNIFI_PASSWORD`. Use a local account.
- **OpenWrt** with LuCI: `OPENWRT_URL`, `OPENWRT_USERNAME`, `OPENWRT_PASSWORD`.

Adding another router means writing one file in `server/src/routers/` that returns `RouterClient[]` (see `types.ts`) and registering it in `index.ts`.

## Using it

- **New devices** pulse and get a NEW badge. On the first scan everything already present counts as known. After that, anything that joins is flagged until you press **It's mine**.
- **Name, owner, notes and type** are yours to set in the detail panel. Notes are the place to record what a device actually does. Types are guessed from model, Bonjour services, hostname, open ports and vendor until you override them.
- **What it's running** lists open ports (with page titles for web UIs, clickable) and Bonjour services.
- **Tree or Radial.** Tree lays the network out left to right: router → network gear → groups → devices. Radial wraps the same tree around the router as an overview. The choice is remembered.
- **Group by type, owner, or flat.** Type buckets devices into Computers, Phones, TV & audio and so on. Owner uses the owner you set on each device. Real switches and access points reported by a router always stay as their own branches.
- **Fold branches.** Click a group (or its chevron in tree mode) to collapse or expand it. The node you clicked stays put while the rest reflows. **Collapse** and **Expand** in the toolbar do every group at once.
- **Hover** a device or group to light up its route to the router and everything beneath it. Click a device to keep its route lit and open its details. Choosing a device in the list opens its group and scrolls it into view. **Esc** clears the selection.
- **Navigation:** drag or two-finger scroll to pan, pinch or ⌘-scroll (or a mouse wheel) to zoom, and **⤢** to fit the whole map.
- Search matches names, IPs, MACs, vendors, owners, notes and service names.

## Security check

Every scan also looks for the most common ways a home network gets into trouble. Results appear in the **Security** tab, as a badge on each device in the map and list, and at the top of a device's details. **At risk** in the list filters the map to just those devices.

| Check | What it flags |
| --- | --- |
| **Internet exposure** | Ports your router has opened to the internet through UPnP, and whether UPnP is on at all. Mappings to risky services are critical. If your router sits behind another router, they're downgraded |
| **Risky services** | Telnet, FTP, Docker's unencrypted API, Android debugging, Redis, MongoDB, Elasticsearch, Memcached, MySQL, PostgreSQL, Remote Desktop, VNC, MQTT, camera streams and SMB file sharing |
| **Unencrypted logins** | Web pages that ask for a password over plain HTTP without redirecting to HTTPS, including the router's admin page. Digest auth isn't flagged because it never sends the password |

For Android debugging and Redis, the scanner opens the connection the way a normal client would and reads the greeting. That tells "anyone can connect" (critical) apart from "needs approval or a password" (lower).

It only looks. It never tries passwords, sends exploits, or adds or removes router mappings. Only online devices are rated, since only their ports were re-checked. If something is intentional, such as SSH on your own server, press **This is expected** and it moves to a collapsed list instead of counting against you.

## API

| Method | Path | |
| --- | --- | --- |
| GET | `/api/snapshot` | Devices, links, scan status, router status, warnings, `security` (findings and UPnP status) |
| POST | `/api/scan` | Start a scan now |
| PATCH | `/api/devices/:id` | `{ name, owner, notes, acknowledged, kind, acceptFinding, unacceptFinding }` (`kind: "auto"` returns to guessing; findings take a key like `port:22`) |
| DELETE | `/api/devices/:id` | Forget a device |

Settings in `server/.env`: `PORT`, `HOST` (set `0.0.0.0` to serve the LAN), `SCAN_INTERVAL_MIN` (`0` turns off periodic scans), `SCAN_INTERFACE`. The app reads `EXPO_PUBLIC_API_URL` if the scanner isn't on `localhost:4319`.

## Contributing

Issues and pull requests are welcome. Useful areas:

- **Router adapters.** TP-Link (Deco, Omada), ASUS, eero, Fritz!Box and others. Each one is a single file in `server/src/routers/`.
- **Better device guesses.** Classification rules live in `server/src/classify.ts`.
- **More security checks.** Rules live in `server/src/security.ts`. Checks must stay read-only: no password guessing, no exploits.
- **Windows support** for discovery in `server/src/discover.ts`.

Run `npm test` and `npm run typecheck` before opening a PR.

## License

[MIT](LICENSE)
