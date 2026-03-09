# Plan: Multi-Device GPS Sharing & Cloud Sync

## Context

The user wants to use their phone (with GPS) as a position source for a tablet at the nav station — both running Pelorus Nav as a PWA. The phone captures GPS, the tablet displays the chart with the phone's position. Eventually, routes and tracks should also sync across devices via a cloud backend.

These are two distinct problems with different protocols:
- **GPS sharing**: real-time, 1Hz, ephemeral — needs low-latency relay
- **Data sync**: eventually-consistent, persistent — needs a database

This plan covers both, with GPS sharing as the immediate priority.

## Key Architectural Insight

The existing `NavigationDataProvider` interface is perfectly suited for this. A `RelayGPSProvider` is just another provider — select it as GPS source, everything downstream (vessel layer, chart mode, HUD, track recording) works unchanged. The sharing side subscribes to the active provider and forwards over WebSocket.

## Phase A: Real-Time GPS Sharing

### Approach: Cloudflare Durable Objects as WebSocket Relay

**Why a cloud relay?**
- Browsers cannot host WebSocket servers, so direct device-to-device isn't possible in a PWA
- WebRTC still needs a signaling server and NAT traversal is unreliable on boat WiFi
- Already on Cloudflare (worker.ts + wrangler.toml), so adding a Durable Object is incremental
- Cost is negligible: 1Hz × 100 bytes = 360KB/hour per boat

**Offline fallback**: Signal K (already implemented). For boats with a local Signal K server on a Raspberry Pi, that handles the no-internet case. The cloud relay is the "easy setup" path for everyone else.

### Pairing UX

1. **Phone (sharer)**: Tap "Share GPS" → app generates 6-char room code (e.g. "A3X7K2"), displays it large on screen
2. **Tablet (receiver)**: Select "Remote GPS" as GPS source → enter room code → connected
3. **Persistent**: Room code saved to localStorage for auto-reconnect next time

Why room codes over accounts? Zero auth needed, works immediately, 36^6 = 2.2B possible codes. Account-based linking can come with Phase B.

### Wire Protocol

Simple JSON over WebSocket:

```typescript
// Client → Server
| { type: "join"; roomCode: string; role: "sharer" | "receiver"; deviceName: string }
| { type: "nav"; data: NavigationData }
| { type: "ping" }

// Server → Client
| { type: "joined"; roomCode: string; peers: string[] }
| { type: "nav"; data: NavigationData; from: string }
| { type: "peer-joined"; deviceName: string }
| { type: "peer-left"; deviceName: string }
| { type: "error"; message: string }
| { type: "pong" }
```

### Wake Lock

The sharing phone must stay in foreground (iOS limitation — no background GPS in PWAs). Use the Wake Lock API to prevent screen sleep:

```typescript
if ("wakeLock" in navigator) {
  wakeLock = await navigator.wakeLock.request("screen");
}
```

Re-acquire on `visibilitychange` event. The sharer UI should prominently show "Sharing GPS" so the user knows not to switch apps.

### New Files

```
src/sync/
  relay-protocol.ts       — Shared types, constants, room code generation
  GPSRelaySharer.ts       — Subscribes to navManager, publishes to relay WebSocket
  RelayGPSProvider.ts     — NavigationDataProvider that receives from relay
  ShareGPSPanel.ts        — UI: start/stop sharing, display room code, status
  RoomCodeInput.ts        — UI: enter room code when selecting Remote GPS source
```

**1. `src/sync/relay-protocol.ts`** — Types and constants
- `ClientMessage` / `ServerMessage` union types
- `RELAY_URL` constant (production CF URL, configurable for self-hosting)
- `generateRoomCode()` using `crypto.getRandomValues`, 6 alphanumeric chars
- `ROOM_CODE_REGEX` for validation

**2. `src/sync/GPSRelaySharer.ts`** — Sender module (not a provider)
- Constructor takes `NavigationDataManager`
- `start(roomCode?)`: opens WebSocket, subscribes to navManager, forwards NavigationData at 1Hz
- `stop()`: closes WebSocket, unsubscribes, releases Wake Lock
- `getRoomCode()`, `isSharing()`, `onStatusChange(callback)`
- Auto-reconnect with exponential backoff (1s → 30s max)
- Acquires Wake Lock on start

**3. `src/sync/RelayGPSProvider.ts`** — Receiver (implements NavigationDataProvider)
- Pattern: follow `SignalKProvider.ts` — WebSocket-based, with reconnect
- `id = "relay-gps"`, `name = "Remote GPS"`
- `connect()`: opens WebSocket, joins room as receiver
- On `nav` message: broadcast `NavigationData` to subscribers
- Stale data warning: if no message for 10s, could emit status

**4. `src/sync/ShareGPSPanel.ts`** — Sharer UI panel
- Togglable panel (PanelStack pattern)
- Shows: large room code, sharing status, connected receiver count
- "Start/Stop Sharing" button
- Wake Lock indicator
- Accessible from new toolbar button in top bar

**5. `src/sync/RoomCodeInput.ts`** — Receiver pairing UI
- Shown when "Remote GPS" is selected as GPS source
- 6-character input with auto-uppercase
- Saves last-used room code to localStorage
- QR scanning deferred (typing 6 chars is fast enough for v1)

### Server-Side Files

**6. `src/worker-relay.ts`** — Cloudflare Durable Object
- Class `GPSRelayRoom` with WebSocket hibernation
- `Map<WebSocket, { role, deviceName }>` of connected clients
- Relay `nav` messages from sharers → all receivers
- Broadcast `peer-joined`/`peer-left` on connect/disconnect
- Rate limit: max 2 sharers, 10 receivers per room
- Room auto-expires when all clients disconnect (DO hibernates)

**7. `src/worker.ts`** — Add routing
- Path `/relay/:roomCode` → forward to Durable Object stub
- `env.GPS_RELAY.get(env.GPS_RELAY.idFromName(roomCode))`

**8. `wrangler.toml`** — Add DO binding
```toml
[durable_objects]
bindings = [{ name = "GPS_RELAY", class_name = "GPSRelayRoom" }]

[[migrations]]
tag = "v1"
new_classes = ["GPSRelayRoom"]
```

### Modified Files

- `src/navigation/index.ts` — export RelayGPSProvider
- `src/main.ts` — register RelayGPSProvider, add Share GPS toolbar button
- `src/settings.ts` — add `relayRoomCode: string | null`
- `src/ui/SettingsPanel.ts` — add "Remote GPS" to GPS source dropdown, show room code input when selected

### Sequence Diagram

```
Phone (Sharer)              Cloudflare DO              Tablet (Receiver)
     |                           |                           |
     |-- WS connect ----------->|                           |
     |-- join(room, sharer) --->|                           |
     |<-- joined(room, []) -----|                           |
     |                           |<-- WS connect -----------|
     |                           |<-- join(room, receiver) -|
     |<-- peer-joined ----------|-- joined(room, [phone]) ->|
     |                           |                           |
     |-- nav(position) -------->|-- nav(position) --------->|
     |-- nav(position) -------->|-- nav(position) --------->|
     |   (1Hz)                  |   (relayed)               |   (displayed)
```

### Error Handling

- **Internet drops**: Auto-reconnect with backoff. Receiver shows stale data warning after 10s.
- **Tab backgrounded (iOS)**: GPS stops. Receiver sees stale data. Sharer UI warns "keep app in foreground."
- **Room code saved**: Auto-reconnect on app restart without re-entering code.

## Phase B: Cloud-Synced Routes & Tracks (Future)

### Approach: Cloudflare D1 (SQLite at the Edge)

Same vendor, serverless, SQL, cheap. The relay Worker already exists — add REST endpoints alongside.

### Sync Strategy

- **Tracks (append-only)**: Upload new points since last sync. Deduplicate by UUID. No conflicts possible.
- **Routes (editable)**: Last-writer-wins by `updatedAt` timestamp. Concurrent route editing is rare in practice.
- **Trigger**: On app start, on online→offline transition, periodically (5 min).

### Auth

- v1: Anonymous device tokens (UUID in localStorage). Devices linked to a "boat" via persistent pairing code (reuse room code concept from Phase A).
- v2: Optional email accounts for multi-boat, fleet management.

### New Files (Phase B, sketched)

- `src/sync/SyncManager.ts` — orchestrates push/pull against D1
- `src/worker-sync.ts` — REST endpoints: `/api/sync/push`, `/api/sync/pull`
- `src/data/db.ts` — schema v2: add `syncVersion`, `syncedAt`, `deviceId` columns
- D1 migration SQL

## Build Order (Phase A)

1. `relay-protocol.ts` — types first, no deps
2. `worker-relay.ts` + `wrangler.toml` — deploy DO, test with wscat
3. `worker.ts` — add routing
4. `GPSRelaySharer.ts` — sharer logic
5. `RelayGPSProvider.ts` — receiver provider
6. `ShareGPSPanel.ts` + `RoomCodeInput.ts` — UI
7. `settings.ts`, `SettingsPanel.ts`, `main.ts` — integration
8. Tests — unit tests for protocol/sharer/provider

## Key Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Relay transport | CF Durable Objects | Already on CF, native WS hibernation, near-zero cost |
| Pairing | 6-char room codes | Simple, no auth, cross-platform |
| Protocol | JSON over WebSocket | Debuggable, tiny payloads at 1Hz |
| Wake Lock | Screen wake lock API | Only reliable option for iOS foreground GPS |
| Offline GPS | Defer to Signal K | Already works locally; don't reinvent |
| Cloud DB (Phase B) | Cloudflare D1 | Same vendor, serverless SQL, cheap |
| Conflict resolution | Last-writer-wins | Pragmatic; concurrent edits rare on a boat |

## Verification (Phase A)

1. `bun run check` passes
2. Deploy relay DO to Cloudflare (`wrangler deploy`)
3. Phone: start simulator, tap Share GPS → room code appears
4. Tablet: select Remote GPS, enter room code → vessel appears on chart
5. Drag phone around → tablet updates in real time
6. Kill internet → receiver shows stale warning, auto-reconnects when back
7. Signal K still works as alternative GPS source (no regression)
