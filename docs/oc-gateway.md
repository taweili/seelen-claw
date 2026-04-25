# OpenClaw Gateway Protocol — Reference & Client Design

## 1. Overview

The OpenClaw Gateway Protocol is a **WebSocket-based control plane + node transport** that serves as the single communication backbone for all OpenClaw clients: CLI, web UI, macOS/iOS/Android apps, and headless nodes. Every client connects over WebSocket and declares its **role** and **scope** at handshake time.

---

## 2. Transport

| Aspect | Detail |
|---|---|
| Transport | WebSocket, text frames with JSON payloads |
| First frame | Must be a `connect` request (after server sends `connect.challenge`) |
| Pre-connect limit | ≤ 64 KiB per frame |
| Post-handshake limits | Follow `hello-ok.policy.maxPayload` and `hello-ok.policy.maxBufferedBytes` |
| Oversized frames | Emit `payload.large` diagnostic events before gateway closes connection |

### 2.1 Frame Types

The protocol uses three frame shapes:

```typescript
// Request — sent by client
interface Request {
  type: "req";
  id: string;       // unique request ID (UUID)
  method: string;   // RPC method name, e.g. "connect", "sessions.list"
  params: Record<string, unknown>;
}

// Response — sent by gateway
interface Response {
  type: "res";
  id: string;       // matches the request ID
  ok: boolean;
  payload?: Record<string, unknown>;  // present when ok === true
  error?: {                           // present when ok === false
    message: string;
    details?: {
      code?: string;                  // e.g. "AUTH_TOKEN_MISMATCH"
      canRetryWithDeviceToken?: boolean;
      recommendedNextStep?: string;
    };
  };
}

// Event — pushed by gateway (broadcast or targeted)
interface Event {
  type: "event";
  event: string;    // e.g. "connect.challenge", "exec.approval.requested"
  payload: Record<string, unknown>;
  seq?: number;     // per-client monotonic sequence number
  stateVersion?: number;
}
```

Side-effecting methods require **idempotency keys** (see protocol schema).

---

## 3. Handshake

### 3.1 Challenge-Response Flow

```
Client                              Gateway
  |                                    |
  |  <--- connect.challenge (event)    |
  |                                    |
  |  connect (req) ------------------> |
  |                                    |
  |  <--- hello-ok (res)              |
  |                                    |
```

**Step 1 — Server Challenge:**
```json
{
  "type": "event",
  "event": "connect.challenge",
  "payload": { "nonce": "abc123...", "ts": 1737264000000 }
}
```

**Step 2 — Client Connect:**
```json
{
  "type": "req",
  "id": "req-001",
  "method": "connect",
  "params": {
    "minProtocol": 3,
    "maxProtocol": 3,
    "client": {
      "id": "my-client",
      "version": "1.0.0",
      "platform": "linux",
      "mode": "operator"
    },
    "role": "operator",
    "scopes": ["operator.read", "operator.write"],
    "caps": [],
    "commands": [],
    "permissions": {},
    "auth": { "token": "..." },
    "locale": "en-US",
    "userAgent": "my-client/1.0.0",
    "device": {
      "id": "device_fingerprint",
      "publicKey": "base64...",
      "signature": "base64...",
      "signedAt": 1737264000000,
      "nonce": "abc123..."
    }
  }
}
```

**Step 3 — Gateway hello-ok:**
```json
{
  "type": "res",
  "id": "req-001",
  "ok": true,
  "payload": {
    "type": "hello-ok",
    "protocol": 3,
    "server": { "version": "1.2.3", "connId": "conn-abc" },
    "features": { "methods": ["health", "sessions.list", "..."], "events": ["tick", "presence", "..."] },
    "snapshot": { "..." : "..." },
    "policy": {
      "maxPayload": 26214400,
      "maxBufferedBytes": 52428800,
      "tickIntervalMs": 15000
    },
    "auth": {
      "role": "operator",
      "scopes": ["operator.read", "operator.write"],
      "deviceToken": "eyJ..."
    }
  }
}
```

### 3.2 Device Identity + Signing

- Clients **must** include a `device` block with a stable device ID derived from a keypair fingerprint.
- The client signs the challenge `nonce` using its private key.
- The preferred signature payload is **`v3`**, which binds `platform` and `deviceFamily` in addition to device/client/role/scopes/token/nonce fields.
- Legacy `v2` signatures remain accepted for compatibility.
- All connections must sign the server-provided `connect.challenge` nonce.

**Error codes for device auth migration:**

| Error Code | Reason | Meaning |
|---|---|---|
| `DEVICE_AUTH_NONCE_REQUIRED` | `device-nonce-missing` | Client omitted `device.nonce` |
| `DEVICE_AUTH_NONCE_MISMATCH` | `device-nonce-mismatch` | Client signed with stale/wrong nonce |
| `DEVICE_AUTH_SIGNATURE_INVALID` | `device-signature` | Signature doesn't match v2/v3 payload |
| `DEVICE_AUTH_SIGNATURE_EXPIRED` | `device-signature-stale` | Signed timestamp outside allowed skew |
| `DEVICE_AUTH_DEVICE_ID_MISMATCH` | `device-id-mismatch` | `device.id` doesn't match public key fingerprint |
| `DEVICE_AUTH_PUBLIC_KEY_INVALID` | `device-public-key` | Public key format/canonicalization failed |

---

## 4. Roles & Scopes

### 4.1 Roles

| Role | Purpose |
|---|---|
| `operator` | Control plane client (CLI, web UI, automation) |
| `node` | Capability host (camera, screen, canvas, system.run) |

### 4.2 Operator Scopes

| Scope | Purpose |
|---|---|
| `operator.read` | Read-only access to sessions, status, config, tools |
| `operator.write` | Write access (send messages, update sessions) |
| `operator.admin` | Full admin (config changes, updates, installs) |
| `operator.approvals` | Approve/deny exec requests |
| `operator.pairing` | Manage device pairing |
| `operator.talk.secrets` | Access secrets in talk config |

### 4.3 Node Capabilities

Nodes declare capability claims at connect time (treated as **claims**, enforced server-side):

| Field | Description |
|---|---|
| `caps` | High-level capability categories: `camera`, `canvas`, `screen`, `location`, `voice` |
| `commands` | Command allowlist for invoke: `camera.snap`, `canvas.navigate`, `screen.record`, `location.get` |
| `permissions` | Granular toggles: `{ "camera.capture": true, "screen.record": false }` |

### 4.4 Broadcast Event Scoping

Server-pushed broadcast events are **scope-gated**:

| Event Family | Required Scope |
|---|---|
| Chat, agent, tool-result frames | `operator.read` (minimum) |
| Plugin `plugin.*` broadcasts | `operator.write` or `operator.admin` |
| Status/transport events (`heartbeat`, `presence`, `tick`) | Unrestricted (all authenticated sessions) |
| Unknown broadcast families | Fail-closed (blocked by default) |

---

## 5. RPC Method Families

### 5.1 System & Identity

| Method | Scope | Description |
|---|---|---|
| `health` | — | Gateway health snapshot |
| `status` | admin for sensitive fields | Gateway summary |
| `diagnostics.stability` | operator.read | Diagnostic stability recorder |
| `gateway.identity.get` | — | Gateway device identity |
| `system-presence` | — | Connected device presence |
| `system-event` | — | Append system event |
| `last-heartbeat` | — | Latest heartbeat event |
| `set-heartbeats` | — | Toggle heartbeat processing |

### 5.2 Models & Usage

| Method | Scope | Description |
|---|---|---|
| `models.list` | — | Runtime-allowed model catalog |
| `usage.status` | — | Provider usage/remaining quota |
| `usage.cost` | — | Aggregated cost summaries |
| `doctor.memory.status` | — | Vector-memory/embedding readiness |
| `sessions.usage` | — | Per-session usage summaries |
| `sessions.usage.timeseries` | — | Timeseries usage |
| `sessions.usage.logs` | — | Usage log entries |

### 5.3 Sessions & Chat

| Method | Scope | Description |
|---|---|---|
| `sessions.list` | — | Current session index |
| `sessions.subscribe` | — | Subscribe to session changes |
| `sessions.messages.subscribe` | — | Subscribe to transcript events |
| `sessions.preview` | — | Bounded transcript preview |
| `sessions.create` | operator.write | Create new session |
| `sessions.send` | operator.write | Send message to session |
| `sessions.steer` | operator.write | Interrupt-and-steer |
| `sessions.abort` | operator.write | Abort active work |
| `sessions.patch` | operator.write | Update session metadata |
| `sessions.reset` | operator.write | Reset session |
| `sessions.delete` | operator.write | Delete session |
| `sessions.compact` | operator.write | Compact session |
| `sessions.get` | operator.read | Get full session row |
| `sessions.resolve` | — | Resolve session target |
| `chat.history` | — | Normalized chat history |
| `chat.send` | operator.write | Send into chat runner |
| `chat.abort` | operator.write | Abort chat |
| `chat.inject` | operator.write | Inject into chat |

### 5.4 Config & Secrets

| Method | Scope | Description |
|---|---|---|
| `config.get` | operator.read | Current config snapshot |
| `config.set` | operator.admin | Write validated config |
| `config.patch` | operator.admin | Merge partial config |
| `config.apply` | operator.admin | Validate + replace full config |
| `config.schema` | operator.read | Live config schema |
| `config.schema.lookup` | operator.read | Path-scoped schema lookup |
| `secrets.reload` | operator.admin | Re-resolve SecretRefs |
| `secrets.resolve` | operator.admin | Resolve secret assignments |

### 5.5 Agent & Workspace

| Method | Scope | Description |
|---|---|---|
| `agents.list` | — | Configured agent entries |
| `agents.create` | operator.admin | Create agent |
| `agents.update` | operator.admin | Update agent |
| `agents.delete` | operator.admin | Delete agent |
| `agents.files.list` | — | List workspace files |
| `agents.files.get` | — | Get workspace file |
| `agents.files.set` | operator.admin | Set workspace file |
| `agent.identity.get` | — | Assistant identity |
| `agent.wait` | — | Wait for run to finish |

### 5.6 Node Operations

| Method | Scope | Description |
|---|---|---|
| `node.list` | — | Known/connected node state |
| `node.describe` | — | Node description |
| `node.invoke` | operator.write | Forward command to node |
| `node.invoke.result` | — | Get invoke result |
| `node.event` | — | Node-originated event |
| `node.pair.request` | — | Request node pairing |
| `node.pair.list` | — | List paired nodes |
| `node.pair.approve` | operator.pairing (+ extra checks) | Approve node |
| `node.pair.reject` | operator.pairing | Reject node |
| `node.pair.verify` | — | Verify node |
| `node.pending.pull` | — | Pull pending work queue |
| `node.pending.ack` | — | Ack pending work |
| `node.pending.enqueue` | — | Enqueue work for offline node |
| `node.pending.drain` | — | Drain pending work |

### 5.7 Device Pairing & Tokens

| Method | Scope | Description |
|---|---|---|
| `device.pair.list` | — | Pending + approved devices |
| `device.pair.approve` | operator.pairing | Approve device |
| `device.pair.reject` | operator.pairing | Reject device |
| `device.pair.remove` | operator.pairing | Remove device |
| `device.token.rotate` | operator.pairing (or self-scoped) | Rotate device token |
| `device.token.revoke` | operator.pairing (or self-scoped) | Revoke device token |

### 5.8 Exec Approvals

| Method | Scope | Description |
|---|---|---|
| `exec.approval.request` | — | Request exec approval |
| `exec.approval.get` | — | Get single approval |
| `exec.approval.list` | — | List approvals |
| `exec.approval.resolve` | operator.approvals | Approve/deny |
| `exec.approval.waitDecision` | — | Wait for decision |
| `exec.approvals.get` | — | Get approval policy |
| `exec.approvals.set` | operator.admin | Set approval policy |

### 5.9 Skills & Tools

| Method | Scope | Description |
|---|---|---|
| `skills.status` | operator.read | Skill inventory |
| `skills.search` | operator.read | ClawHub discovery |
| `skills.detail` | operator.read | ClawHub detail |
| `skills.install` | operator.admin | Install skill |
| `skills.update` | operator.admin | Update skill |
| `skills.bins` | node | Skill executables (auto-allow) |
| `tools.catalog` | operator.read | Runtime tool catalog |
| `tools.effective` | operator.read | Effective tool inventory for session |
| `commands.list` | operator.read | Runtime command inventory |

### 5.10 Update, Wizard, Cron

| Method | Scope | Description |
|---|---|---|
| `update.run` | operator.admin | Run gateway update |
| `wizard.start` | — | Start onboarding wizard |
| `wizard.next` | — | Wizard step |
| `wizard.status` | — | Wizard status |
| `wizard.cancel` | — | Cancel wizard |
| `cron.list` | — | List cron jobs |
| `cron.add` | operator.admin | Add cron job |
| `cron.update` | operator.admin | Update cron job |
| `cron.remove` | operator.admin | Remove cron job |
| `cron.run` | operator.admin | Run cron job |

### 5.11 Talk & TTS

| Method | Scope | Description |
|---|---|---|
| `talk.config` | operator.read (secrets → operator.talk.secrets) | Talk config |
| `talk.mode` | operator.write | Set Talk mode |
| `talk.speak` | operator.write | Synthesize speech |
| `tts.status` | — | TTS status |
| `tts.providers` | — | TTS provider inventory |
| `tts.enable` | operator.admin | Enable TTS |
| `tts.disable` | operator.admin | Disable TTS |
| `tts.setProvider` | operator.admin | Set TTS provider |
| `tts.convert` | — | Text-to-speech conversion |

---

## 6. Event Families

| Event | Description |
|---|---|
| `connect.challenge` | Pre-connect challenge with nonce |
| `chat.*` | UI chat updates (`chat.inject`, transcript events) |
| `session.message` | Transcript message updates (subscribed session) |
| `session.tool` | Tool call events (subscribed session) |
| `sessions.changed` | Session index/metadata changed |
| `presence` | System presence snapshot updates |
| `tick` | Periodic keepalive/liveness |
| `health` | Gateway health snapshot update |
| `heartbeat` | Heartbeat event stream |
| `cron` | Cron run/job change |
| `shutdown` | Gateway shutdown notification |
| `node.pair.requested` | Node pairing request |
| `node.pair.resolved` | Node pairing resolved |
| `node.invoke.request` | Node invoke request broadcast |
| `device.pair.requested` | Device pairing request |
| `device.pair.resolved` | Device pairing resolved |
| `voicewake.changed` | Wake-word config changed |
| `exec.approval.requested` | Exec approval requested |
| `exec.approval.resolved` | Exec approval resolved |
| `plugin.approval.requested` | Plugin approval requested |
| `plugin.approval.resolved` | Plugin approval resolved |
| `payload.large` | Oversized frame diagnostic |

---

## 7. Client Constants

| Constant | Default | Notes |
|---|---|---|
| `PROTOCOL_VERSION` | `3` | Protocol schema version |
| Request timeout | `30,000` ms | Per-RPC |
| Preauth/connect-challenge timeout | `10,000` ms | Clamped 250–10,000 |
| Initial reconnect backoff | `1,000` ms | Exponential backoff start |
| Max reconnect backoff | `30,000` ms | Exponential backoff cap |
| Fast-retry clamp (after device-token close) | `250` ms | Quick reconnect attempt |
| Force-stop grace before `terminate()` | `250` ms | Grace period |
| `stopAndWait()` default timeout | `1,000` ms | Stop wait |
| Default tick interval (pre hello-ok) | `30,000` ms | Client-side tick |
| Tick-timeout close | `tickIntervalMs * 2` | Close code `4000` |
| `MAX_PAYLOAD_BYTES` | `25 * 1024 * 1024` (25 MB) | Server limit |

**Important:** After handshake, clients should honor server-advertised `policy.tickIntervalMs`, `policy.maxPayload`, and `policy.maxBufferedBytes` instead of pre-handshake defaults.

---

## 8. Authentication

### 8.1 Auth Assembly Priority

Client-side connect auth is assembled in this priority order:

1. **Explicit shared token** → `auth.token`
2. **Explicit deviceToken** → `auth.token`
3. **Stored per-device token** (keyed by `deviceId` + `role`) → `auth.token`
4. **Bootstrap token** → `auth.bootstrapToken` (only when none of above resolved)

`auth.password` is orthogonal and always forwarded when set.

### 8.2 Auth Modes

| Mode | Description |
|---|---|
| Shared-secret | `connect.params.auth.token` or `connect.params.auth.password` |
| Tailscale Serve | `gateway.auth.allowTailscale: true` — auth from request headers |
| Trusted-proxy | `gateway.auth.mode: "trusted-proxy"` — auth from headers |
| Private-ingress | `gateway.auth.mode: "none"` — skips shared-secret (do NOT expose publicly) |

### 8.3 Device Token Lifecycle

1. After pairing, gateway issues a **device token** scoped to role + scopes
2. Token returned in `hello-ok.auth.deviceToken`
3. Client **must persist** it for future connects
4. Reconnecting with stored token should reuse stored approved scope set
5. Tokens can be rotated via `device.token.rotate` or revoked via `device.token.revoke`
6. Token rotation cannot expand device into roles never granted by pairing

### 8.4 AUTH_TOKEN_MISMATCH Handling

```
Auth failure with AUTH_TOKEN_MISMATCH
        │
        ├─ Trusted endpoint (loopback / wss:// + pinned tlsFingerprint)
        │   └─ Retry once with cached per-device token
        │       ├─ Success → continue
        │       └─ Fail → stop auto-reconnect, surface operator guidance
        │
        └─ Untrusted endpoint (public wss:// without pinning)
            └─ Do NOT auto-retry with cached token
               → Surface operator guidance immediately
```

Auth failures include recovery hints:
- `error.details.canRetryWithDeviceToken` (boolean)
- `error.details.recommendedNextStep` (enum: `retry_with_device_token`, `update_auth_configuration`, `update_auth_credentials`, `wait_then_retry`, `review_auth_configuration`)

---

## 9. Versioning

- `PROTOCOL_VERSION` is defined in `src/gateway/protocol/schema/protocol-schemas.ts`
- Clients send `minProtocol` + `maxProtocol`; server rejects mismatches
- Schemas generated from TypeBox definitions:
  - `pnpm protocol:gen` — Generate TS schemas
  - `pnpm protocol:gen:swift` — Generate Swift schemas
  - `pnpm protocol:check` — Validate schemas

---

## 10. TLS & Pinning

- TLS is supported for WS connections (`wss://`)
- Clients may optionally pin the gateway cert fingerprint via `gateway.remote.tlsFingerprint` or CLI `--tls-fingerprint`
- Trusted bootstrap handoff + auto-promotion of stored device token is gated to **trusted endpoints only** (loopback, or `wss://` with pinned `tlsFingerprint`)

---

## 11. Exec Approvals (Detailed)

When an exec request needs approval:

1. Gateway broadcasts `exec.approval.requested` event
2. Operator client resolves via `exec.approval.resolve` (requires `operator.approvals`)
3. For `host=node`, `exec.approval.request` **must** include `systemRunPlan`:
   ```json
   {
     "argv": ["bash", "-c", "echo hello"],
     "cwd": "/workspace",
     "rawCommand": "echo hello",
     "agentId": "...",
     "sessionKey": "..."
   }
   ```
4. After approval, forwarded `node.invoke system.run` calls reuse that canonical `systemRunPlan`
5. **Anti-tamper**: If caller mutates `command`, `rawCommand`, `cwd`, `agentId`, or `sessionKey` between prepare and final approved `system.run`, the gateway **rejects** the run

---

## 12. Agent Delivery Fallback

`agent` requests can include delivery options:

| Option | Behavior |
|---|---|
| `deliver: true` | Request outbound delivery |
| `bestEffortDeliver: false` (default) | Strict: unresolved targets return `INVALID_REQUEST` |
| `bestEffortDeliver: true` | Fallback to session-only execution when no external route available |

---

## 13. Presence

- `system-presence` returns entries keyed by **device identity** (not connection)
- Presence entries include `deviceId`, `roles`, and `scopes`
- UIs can show a single row per device even when it connects as both **operator** and **node**
