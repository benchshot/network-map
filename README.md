# Network Map

A live map of everything on the home network: what each device is, what it's running, what it's connected to, and when something new shows up.

| Path | What it is |
| --- | --- |
| `server/` | The scanner: a small Node + TypeScript service (no build step, Node ≥ 23 runs the `.ts` directly). It pings the subnet, reads the ARP table, listens for Bonjour/mDNS, probes common ports, optionally asks the router, and serves `/api/*`. State lives in `server/data/devices.json` |
| `app/` | The UI: Expo / React Native + TypeScript, run as a web app. Collapsible tree and radial maps (d3-hierarchy + react-native-svg), searchable device list, editable detail panel |

## Run it

```sh
npm run setup     # installs both halves
npm run scanner   # http://127.0.0.1:4319, rescans every 5 min
npm run web       # http://localhost:8081
```

The scanner has to run on a machine on the LAN, such as this Mac or the home server, because a browser can't scan a network on its own.

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

## API

| Method | Path | |
| --- | --- | --- |
| GET | `/api/snapshot` | Devices, links, scan status, router status, warnings |
| POST | `/api/scan` | Start a scan now |
| PATCH | `/api/devices/:id` | `{ name, owner, notes, acknowledged, kind }` (`kind: "auto"` returns to guessing) |
| DELETE | `/api/devices/:id` | Forget a device |

Settings in `server/.env`: `PORT`, `HOST` (set `0.0.0.0` to serve the LAN), `SCAN_INTERVAL_MIN` (`0` turns off periodic scans), `SCAN_INTERFACE`. The app reads `EXPO_PUBLIC_API_URL` if the scanner isn't on `localhost:4319`.
