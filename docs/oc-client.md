# OpenClaw Gateway — Client Design

## Architecture

```
┌──────────────────────────────────────────────────────────┐
│                    Client Application                     │
├──────────────────────────────────────────────────────────┤
│                                                          │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────────┐ │
│  │  EventBus   │  │  SessionMgr  │  │   CommandRouter  │ │
│  │             │  │              │  │                  │ │
│  │  subscribe  │  │  list()      │  │  dispatch(method)│ │
│  │  emit(type) │  │  create()    │  │  exec(method)    │ │
│  │  listeners  │  │  send()      │  │  catalog()       │ │
│  └──────┬──────┘  │  subscribe() │  └────────┬─────────┘ │
│         │         │  steer()     │           │           │
│         │         │  abort()     │           │           │
│         │         └──────┬───────┘           │           │
│         │                │                   │           │
│  ┌──────▼────────────────▼───────────────────▼─────────┐ │
│  │                RpcClient                            │ │
│  │                                                     │ │
│  │  • Request/Response matching (id → Promise)         │ │
│  │  • Timeout management (30s default)                 │ │
│  │  • Retry with exponential backoff                   │ │
│  │  • Protocol version negotiation                     │ │
│  └──────────────────────┬──────────────────────────────┘ │
│                         │                                │
│  ┌──────────────────────▼──────────────────────────────┐ │
│  │              TransportLayer                         │ │
│  │                                                     │ │
│  │  • WebSocket connection management                  │ │
│  │  • Frame parsing (JSON text frames)                 │ │
│  │  • Tick/keepalive (server-defined interval)         │ │
│  │  • Reconnect with backoff                           │ │
│  │  • Payload size enforcement                         │ │
│  └──────────────────────┬──────────────────────────────┘ │
│                         │                                │
│  ┌──────────────────────▼──────────────────────────────┐ │
│  │              HandshakeManager                        │ │
│  │                                                     │ │
│  │  • connect.challenge reception                      │ │
│  │  • Nonce signing (Ed25519)                          │ │
│  │  • Auth token assembly (priority chain)             │ │
│  │  • Device token persistence                         │ │
│  │  • hello-ok processing (policy, features, auth)     │ │
│  └──────────────────────┬──────────────────────────────┘ │
│                         │                                │
│  ┌──────────────────────▼──────────────────────────────┐ │
│  │              DeviceIdentity                          │ │
│  │                                                     │ │
│  │  • Ed25519 keypair generation & storage              │ │
│  │  • Device fingerprint (public key hash)             │ │
│  │  • Nonce signing (v3 payload)                       │ │
│  │  • Key rotation                                     │ │
│  └─────────────────────────────────────────────────────┘ │
│                                                          │
│  ┌─────────────────────────────────────────────────────┐ │
│  │              TokenStore                              │ │
│  │                                                     │ │
│  │  • Device token persistence (keyed by deviceId+role)│ │
│  │  • Auth token retrieval (priority chain)            │ │
│  │  • Secure storage (OS keychain / encrypted file)    │ │
│  └─────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘
```

## Core Interfaces

### Device Identity

```typescript
import { sign } from "@noble/ed25519";
import { createHash } from "crypto";

interface DeviceIdentity {
  /** Stable device ID — SHA-256 hash of public key (first 32 hex chars) */
  id: string;
  /** Ed25519 public key (base64) */
  publicKey: string;
  /** Sign a message with the private key */
  sign(message: Uint8Array): Promise<Uint8Array>;
}

function generateDeviceIdentity(): DeviceIdentity {
  // Generate Ed25519 keypair
  // Return with id = fingerprint of public key
}

function signChallenge(
  identity: DeviceIdentity,
  nonce: string,
  clientInfo: { id: string; version: string; platform: string },
  role: string,
  scopes: string[],
  deviceToken?: string
): Promise<{ signature: string; signedAt: number; nonce: string }> {
  // Build v3 signing payload:
  // { nonce, deviceId, role, scopes[], client:{id,version,platform}, deviceToken?, signedAt }
  // Sign with Ed25519 private key
  // Return signature (base64), signedAt (epoch ms), nonce
}
```

### Transport Layer

```typescript
type Frame = RequestFrame | ResponseFrame | EventFrame;

interface RequestFrame {
  type: "req";
  id: string;
  method: string;
  params: Record<string, unknown>;
}

interface ResponseFrame {
  type: "res";
  id: string;
  ok: boolean;
  payload?: Record<string, unknown>;
  error?: ResponseError;
}

interface EventFrame {
  type: "event";
  event: string;
  payload: Record<string, unknown>;
  seq?: number;
  stateVersion?: number;
}

interface ResponseError {
  message: string;
  details?: {
    code?: string;
    canRetryWithDeviceToken?: boolean;
    recommendedNextStep?: string;
  };
}

interface TransportConfig {
  url: string;
  tlsFingerprint?: string;  // Optional cert pinning
  maxPayload?: number;       // Override from hello-ok
  maxBufferedBytes?: number; // Override from hello-ok
  tickIntervalMs?: number;   // Override from hello-ok
  requestTimeoutMs?: number; // Default: 30_000
  reconnectBackoffMs?: number; // Default: 1_000
  maxReconnectBackoffMs?: number; // Default: 30_000
}

class TransportLayer {
  private ws: WebSocket | null = null;
  private config: TransportConfig;
  private pendingFrames: Frame[] = [];
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectBackoff: number;
  private isConnecting: boolean = false;

  constructor(config: TransportConfig) {
    this.config = config;
    this.reconnectBackoff = config.reconnectBackoffMs ?? 1_000;
  }

  /** Apply policy from hello-ok */
  applyPolicy(policy: {
    maxPayload?: number;
    maxBufferedBytes?: number;
    tickIntervalMs?: number;
  }): void {
    if (policy.maxPayload) this.config.maxPayload = policy.maxPayload;
    if (policy.maxBufferedBytes) this.config.maxBufferedBytes = policy.maxBufferedBytes;
    if (policy.tickIntervalMs) this.config.tickIntervalMs = policy.tickIntervalMs;
    this.restartTickTimer();
  }

  async connect(): Promise<void> {
    // Create WebSocket connection
    // Set up onmessage → parse JSON → dispatch to handlers
    // Set up onclose → schedule reconnect
    // Set up onerror → schedule reconnect
  }

  send(frame: Frame): void {
    // Check payload size against maxPayload
    // Serialize to JSON text frame
    // Send via WebSocket
  }

  private restartTickTimer(): void {
    // Clear existing timer
    // Start new timer at config.tickIntervalMs
    // Send implicit tick (or explicit if required)
    // If no activity for tickIntervalMs * 2, close with code 4000
  }

  private scheduleReconnect(): void {
    // Exponential backoff: backoffMs * 2, capped at maxReconnectBackoffMs
    // On reconnect success, reset backoff to initial
  }

  disconnect(): void {
    // Clear all timers
    // Close WebSocket
  }
}
```

### RPC Client

```typescript
interface PendingRequest {
  resolve: (response: ResponseFrame) => void;
  reject: (error: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
  method: string;
}

class RpcClient {
  private transport: TransportLayer;
  private pendingRequests: Map<string, PendingRequest> = new Map();
  private requestTimeoutMs: number = 30_000;
  private idCounter: number = 0;

  constructor(transport: TransportLayer) {
    this.transport = transport;
    // Register transport message handler
  }

  /** Generate unique request ID */
  private nextId(): string {
    return `req-${Date.now()}-${++this.idCounter}`;
  }

  /** Send an RPC request and await response */
  async request<T = unknown>(
    method: string,
    params: Record<string, unknown> = {}
  ): Promise<T> {
    const id = this.nextId();
    const frame: RequestFrame = { type: "req", id, method, params };

    return new Promise<T>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id);
        reject(new Error(`RPC timeout: ${method} (${this.requestTimeoutMs}ms)`));
      }, this.requestTimeoutMs);

      this.pendingRequests.set(id, { resolve, reject, timeout, method });

      this.transport.send(frame);
    });
  }

  /** Handle incoming frame from transport */
  handleFrame(frame: Frame): void {
    if (frame.type === "res") {
      const pending = this.pendingRequests.get(frame.id);
      if (pending) {
        clearTimeout(pending.timeout);
        this.pendingRequests.delete(frame.id);

        if (frame.ok) {
          pending.resolve(frame.payload as never);
        } else {
          pending.reject(new RpcError(frame.error));
        }
      }
    }
    // Events are handled by EventBus (below)
  }

  /** Close all pending requests (on disconnect) */
  closeAllRequests(reason: string): void {
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout);
      pending.reject(new Error(`Connection closed: ${reason}`));
    }
    this.pendingRequests.clear();
  }
}

class RpcError extends Error {
  constructor(error?: ResponseError) {
    super(error?.message ?? "Unknown RPC error");
    this.code = error?.details?.code;
    this.details = error?.details;
  }
  code?: string;
  details?: ResponseError["details"];
}
```

### Handshake Manager

```typescript
interface ClientInfo {
  id: string;
  version: string;
  platform: string;
  mode: "operator" | "node";
}

interface ConnectParams {
  role: "operator" | "node";
  scopes: string[];
  client: ClientInfo;
  locale?: string;
  userAgent?: string;
  // For nodes:
  caps?: string[];
  commands?: string[];
  permissions?: Record<string, boolean>;
}

interface HelloOk {
  protocol: number;
  server: { version: string; connId: string };
  features: { methods: string[]; events: string[] };
  snapshot: Record<string, unknown>;
  policy: {
    maxPayload: number;
    maxBufferedBytes: number;
    tickIntervalMs: number;
  };
  auth: {
    role: string;
    scopes: string[];
    deviceToken?: string;
    deviceTokens?: Array<{
      deviceToken: string;
      role: string;
      scopes: string[];
    }>;
  };
  canvasHostUrl?: string;
}

class HandshakeManager {
  private transport: TransportLayer;
  private rpc: RpcClient;
  private deviceIdentity: DeviceIdentity;
  private tokenStore: TokenStore;
  private role: "operator" | "node";
  private scopes: string[];
  private clientInfo: ClientInfo;
  private eventBus: EventBus;
  private maxRetries: number = 1; // AUTH_TOKEN_MISMATCH retry

  async performHandshake(connectParams: ConnectParams): Promise<HelloOk> {
    // Step 1: Wait for connect.challenge event
    const challenge = await this.waitForChallenge();

    // Step 2: Assemble auth token (priority chain)
    const auth = this.assembleAuth();

    // Step 3: Sign the challenge
    const signature = await signChallenge(
      this.deviceIdentity,
      challenge.payload.nonce,
      this.clientInfo,
      this.role,
      this.scopes,
      auth.token
    );

    // Step 4: Build connect request
    const connectReq: RequestFrame = {
      type: "req",
      id: this.rpc.nextId(),
      method: "connect",
      params: {
        minProtocol: 3,
        maxProtocol: 3,
        client: this.clientInfo,
        role: this.role,
        scopes: this.scopes,
        caps: connectParams.caps ?? [],
        commands: connectParams.commands ?? [],
        permissions: connectParams.permissions ?? {},
        auth,
        locale: connectParams.locale ?? "en-US",
        userAgent: connectParams.userAgent ?? `${this.clientInfo.id}/${this.clientInfo.version}`,
        device: {
          id: this.deviceIdentity.id,
          publicKey: this.deviceIdentity.publicKey,
          signature: btoa(String.fromCharCode(...signature.signature)),
          signedAt: signature.signedAt,
          nonce: signature.nonce,
        },
      },
    };

    // Step 5: Send and await response
    const response = await this.rpc.request<HelloOk>("connect", connectReq.params);

    // Step 6: Process hello-ok
    this.processHelloOk(response);

    return response;
  }

  private async waitForChallenge(timeoutMs: number = 10_000): Promise<EventFrame> {
    // Listen for "connect.challenge" event
    // Reject on timeout
  }

  private assembleAuth(): { token?: string; password?: string; bootstrapToken?: string } {
    // Priority chain:
    // 1. Explicit shared token (env/config)
    // 2. Explicit deviceToken (CLI flag)
    // 3. Stored per-device token (tokenStore.getByDeviceId(deviceId, role))
    // 4. Bootstrap token (only if none of above)
    return this.tokenStore.assembleAuth(this.deviceIdentity.id, this.role);
  }

  private processHelloOk(helloOk: HelloOk): void {
    // Apply server policy to transport
    this.transport.applyPolicy(helloOk.policy);

    // Persist device token if issued
    if (helloOk.auth.deviceToken) {
      this.tokenStore.saveDeviceToken(
        this.deviceIdentity.id,
        this.role,
        helloOk.auth.deviceToken,
        helloOk.auth.scopes
      );
    }

    // Persist bootstrap handoff tokens (only on trusted transport)
    if (helloOk.auth.deviceTokens && this.isTrustedEndpoint()) {
      for (const entry of helloOk.auth.deviceTokens) {
        this.tokenStore.saveDeviceToken(
          this.deviceIdentity.id,
          entry.role,
          entry.deviceToken,
          entry.scopes
        );
      }
    }
  }

  private isTrustedEndpoint(): boolean {
    // loopback OR wss:// + pinned tlsFingerprint
    const url = this.transport.getUrl();
    const isLoopback = url.includes("localhost") || url.includes("127.0.0.1") || url.includes("::1");
    const isPinnedWss = url.startsWith("wss://") && this.transport.hasTlsPin();
    return isLoopback || isPinnedWss;
  }

  /** Handle AUTH_TOKEN_MISMATCH with bounded retry */
  async handleAuthTokenMismatch(): Promise<HelloOk | null> {
    if (!this.isTrustedEndpoint() || this.maxRetries <= 0) {
      return null;
    }

    this.maxRetries--;
    // Retry connect with cached per-device token (priority #3)
    // If this fails, return null and surface operator guidance
    return this.performHandshake({ role: this.role, scopes: this.scopes, client: this.clientInfo });
  }
}
```

### Event Bus

```typescript
type EventListener = (payload: Record<string, unknown>, seq?: number) => void;

class EventBus {
  private listeners: Map<string, Set<EventListener>> = new Map();
  private wildcardListeners: Array<{ pattern: RegExp; handler: EventListener }> = [];

  /** Subscribe to a specific event type */
  on(event: string, handler: EventListener): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
    return () => this.listeners.get(event)?.delete(handler);
  }

  /** Subscribe with wildcard pattern (e.g., "session.*", "exec.approval.*") */
  onPattern(pattern: string, handler: EventListener): () => void {
    const regex = new RegExp("^" + pattern.replace(/\*/g, ".*") + "$");
    const listener = { pattern: regex, handler };
    this.wildcardListeners.push(listener);
    return () => {
      const idx = this.wildcardListeners.indexOf(listener);
      if (idx >= 0) this.wildcardListeners.splice(idx, 1);
    };
  }

  /** Dispatch an incoming event to matching listeners */
  emit(event: string, payload: Record<string, unknown>, seq?: number): void {
    // Exact match listeners
    const exact = this.listeners.get(event);
    if (exact) {
      for (const handler of exact) {
        handler(payload, seq);
      }
    }
    // Wildcard listeners
    for (const { pattern, handler } of this.wildcardListeners) {
      if (pattern.test(event)) {
        handler(payload, seq);
      }
    }
  }

  /** Subscribe to a session's messages and tool events */
  subscribeSession(rpc: RpcClient, sessionKey: string): Promise<void> {
    // Call sessions.subscribe + sessions.messages.subscribe
    return rpc.request("sessions.subscribe", { sessionKey })
      .then(() => rpc.request("sessions.messages.subscribe", { sessionKey }));
  }
}
```

### Token Store

```typescript
interface StoredToken {
  deviceToken: string;
  role: string;
  scopes: string[];
  createdAt: number;
}

interface TokenStoreBackend {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  delete(key: string): Promise<void>;
}

class TokenStore {
  private backend: TokenStoreBackend;

  constructor(backend: TokenStoreBackend) {
    this.backend = backend;
  }

  /** Key for per-device+role token storage */
  private tokenKey(deviceId: string, role: string): string {
    return `oc:token:${deviceId}:${role}`;
  }

  /** Key for per-device+role approved scopes */
  private scopeKey(deviceId: string, role: string): string {
    return `oc:scopes:${deviceId}:${role}`;
  }

  async saveDeviceToken(
    deviceId: string,
    role: string,
    token: string,
    scopes: string[]
  ): Promise<void> {
    await this.backend.set(this.tokenKey(deviceId, role), JSON.stringify({
      deviceToken: token,
      role,
      scopes,
      createdAt: Date.now(),
    }));
    await this.backend.set(this.scopeKey(deviceId, role), JSON.stringify(scopes));
  }

  async getDeviceToken(deviceId: string, role: string): Promise<StoredToken | null> {
    const raw = await this.backend.get(this.tokenKey(deviceId, role));
    if (!raw) return null;
    return JSON.parse(raw);
  }

  async getApprovedScopes(deviceId: string, role: string): Promise<string[] | null> {
    const raw = await this.backend.get(this.scopeKey(deviceId, role));
    if (!raw) return null;
    return JSON.parse(raw);
  }

  /** Assemble auth for connect (priority chain) */
  assembleAuth(deviceId: string, role: string): {
    token?: string;
    password?: string;
    bootstrapToken?: string;
  } {
    // Priority 1: Explicit shared token (from env/config)
    const explicitToken = process.env.OPENCLAW_TOKEN;
    if (explicitToken) {
      return { token: explicitToken };
    }

    // Priority 2: Explicit deviceToken (from CLI flag)
    const explicitDeviceToken = process.env.OPENCLAW_DEVICE_TOKEN;
    if (explicitDeviceToken) {
      return { token: explicitDeviceToken };
    }

    // Priority 3: Stored per-device token
    const stored = this.getDeviceToken(deviceId, role); // sync lookup
    // (In real impl, this would be async or use sync storage)

    // Priority 4: Bootstrap token (only if nothing above)
    const bootstrapToken = process.env.OPENCLAW_BOOTSTRAP_TOKEN;

    return {
      token: stored?.deviceToken,
      bootstrapToken: stored ? undefined : bootstrapToken,
    };
  }

  async revokeDeviceToken(deviceId: string, role: string): Promise<void> {
    await this.backend.delete(this.tokenKey(deviceId, role));
    await this.backend.delete(this.scopeKey(deviceId, role));
  }
}
```

## Session Manager

```typescript
class SessionManager {
  private rpc: RpcClient;
  private eventBus: EventBus;

  constructor(rpc: RpcClient, eventBus: EventBus) {
    this.rpc = rpc;
    this.eventBus = eventBus;
  }

  async list(): Promise<Session[]> {
    return this.rpc.request("sessions.list");
  }

  async create(params?: { agentId?: string; key?: string }): Promise<Session> {
    return this.rpc.request("sessions.create", params ?? {});
  }

  async send(sessionKey: string, message: string): Promise<void> {
    return this.rpc.request("sessions.send", { sessionKey, message });
  }

  async steer(sessionKey: string, message: string): Promise<void> {
    return this.rpc.request("sessions.steer", { sessionKey, message });
  }

  async abort(sessionKey: string): Promise<void> {
    return this.rpc.request("sessions.abort", { sessionKey });
  }

  async get(sessionKey: string): Promise<Session> {
    return this.rpc.request("sessions.get", { sessionKey });
  }

  async subscribe(sessionKey: string): Promise<void> {
    await this.rpc.request("sessions.subscribe", { sessionKey });
    await this.rpc.request("sessions.messages.subscribe", { sessionKey });
  }

  async unsubscribe(sessionKey: string): Promise<void> {
    await this.rpc.request("sessions.unsubscribe", { sessionKey });
    await this.rpc.request("sessions.messages.unsubscribe", { sessionKey });
  }

  async preview(sessionKey: string): Promise<TranscriptPreview> {
    return this.rpc.request("sessions.preview", { sessionKey });
  }
}
```

## Reconnection Strategy

```
Disconnect detected
        │
        ├─ Clean close (code 1000 / 1001)
        │   └─ Do NOT reconnect (intentional disconnect)
        │
        ├─ AUTH_TOKEN_MISMATCH → retry once with cached device token
        │   (only on trusted endpoint)
        │
        ├─ Device token issued → fast retry at 250ms
        │
        └─ Other (network error, server crash, tick timeout)
            └─ Exponential backoff:
                1s → 2s → 4s → 8s → 16s → 30s (cap)
                On success → reset to 1s
```

## Client Lifecycle

```
┌─────────────────────────────────────────────────────────┐
│                    Client Lifecycle                      │
│                                                         │
│  1. Generate/load DeviceIdentity (Ed25519 keypair)      │
│  2. Create TransportLayer (WebSocket)                   │
│  3. Create RpcClient + EventBus                         │
│  4. Create HandshakeManager                             │
│  5. TransportLayer.connect()                            │
│  6. HandshakeManager.performHandshake({                 │
│       role: "operator",                                 │
│       scopes: ["operator.read", "operator.write"],      │
│       client: { id: "my-client", version: "1.0.0",     │
│                 platform: "linux", mode: "operator" }   │
│     })                                                  │
│     ├── Wait for connect.challenge event               │
│     ├── Assemble auth (priority chain)                  │
│     ├── Sign challenge nonce (v3 payload)               │
│     ├── Send connect request                            │
│     └── Process hello-ok (policy, features, deviceToken)│
│  7. Start application logic:                            │
│     ├── Subscribe to events (tick, presence, health)   │
│     ├── SessionManager.list() / create() / send()      │
│     ├── Commands.list() / tools.catalog()              │
│     └── Handle events via EventBus                     │
│  8. On disconnect:                                      │
│     ├── RpcClient.closeAllRequests()                    │
│     ├── TransportLayer.scheduleReconnect()              │
│     └─→ Back to step 5                                 │
│  9. On intentional shutdown:                            │
│     ├── TransportLayer.disconnect()                     │
│     └── Clean up resources                             │
└─────────────────────────────────────────────────────────┘
```

## Example: Minimal Client Usage

```typescript
// 1. Initialize
const identity = await loadOrCreateDeviceIdentity("./.openclaw/device.json");
const tokenStore = new TokenStore(new FileTokenStore("./.openclaw/tokens.json"));

const transport = new TransportLayer({
  url: "ws://localhost:3000",
  requestTimeoutMs: 30_000,
});

const rpc = new RpcClient(transport);
const eventBus = new EventBus();
const handshake = new HandshakeManager({
  transport,
  rpc,
  identity,
  tokenStore,
  eventBus,
  role: "operator",
  scopes: ["operator.read", "operator.write"],
  clientInfo: {
    id: "my-client",
    version: "1.0.0",
    platform: "linux",
    mode: "operator",
  },
});

// 2. Connect
await transport.connect();
const helloOk = await handshake.performHandshake({
  role: "operator",
  scopes: ["operator.read", "operator.write"],
  client: { id: "my-client", version: "1.0.0", platform: "linux", mode: "operator" },
});

console.log(`Connected to gateway ${helloOk.server.version}`);
console.log(`Available methods: ${helloOk.features.methods.length}`);

// 3. Use the client
const sessions = new SessionManager(rpc, eventBus);
const sessionList = await sessions.list();
console.log(`Active sessions: ${sessionList.length}`);

// Create and send
const session = await sessions.create({ agentId: "default" });
await sessions.send(session.key, "Hello, OpenClaw!");

// 4. Subscribe to events
eventBus.on("tick", () => console.log("Gateway alive"));
eventBus.on("presence", (payload) => console.log("Presence update:", payload));
eventBus.on("session.message", (payload) => console.log("New message:", payload));

// 5. Disconnect (clean)
transport.disconnect();
```

---

## Security Considerations

1. **Device identity**: Each client MUST have a unique Ed25519 keypair. Never share keys across devices.
2. **Token storage**: Persist device tokens in OS-level secure storage (keychain on macOS, DPAPI on Windows, or encrypted file).
3. **TLS pinning**: When connecting to remote gateways over `wss://`, always pin the TLS fingerprint to prevent MITM attacks.
4. **Nonce signing**: Always wait for the server's `connect.challenge` before signing — never pre-generate nonces.
5. **Auth priority**: Never fall back to bootstrap token when a device token exists.
6. **Trusted endpoints**: Auto-retry with cached device token ONLY on loopback or pinned `wss://` connections.
7. **Scope preservation**: When reconnecting with a stored device token, always reuse the stored approved scope set — never silently collapse to a narrower scope.

---

## Existing Open-Source TypeScript Clients

### 1. `openclaw-client` (npm) — Recommended

```
npm install openclaw-client
```

A third-party TypeScript SDK (v2.1.1, MIT) that wraps the full Gateway WS protocol.

- **Repo:** [github.com/stugreen13/openclaw-client](https://github.com/stugreen13/openclaw-client)
- Covers full handshake (challenge → connect → hello-ok)
- Built-in **Ed25519 device signing** via `DeviceIdentityStore` / `DeviceTokenStore` abstractions
- Works in **browser** (Web Crypto API) and **Node.js** 20+
- Opt-in **auto-reconnection** with configurable exponential backoff
- Callbacks for connection state (`onConnection`) and pairing (`onPairingRequired`)
- ~50 typed convenience methods across all protocol families: sessions, agents, chat, config, models, device pairing, node management, exec approvals, skills, tools, cron, talk/TTS

```typescript
import { OpenClawClient } from 'openclaw-client';

const client = new OpenClawClient({
  gatewayUrl: 'ws://localhost:18789',
  token: 'your-token',
  deviceIdentity: identityStore,
  deviceToken: tokenStore,
  reconnect: { enabled: true },
});

await client.connect();
const sessions = await client.listSessions();
await client.sendChat({ sessionKey: '...', message: 'Hello' });
```

**Gaps vs this design:** Uses `v2` signing payloads (v3 is the protocol preferred); the `connectParams` interface uses a static object or challenge callback rather than the full priority-chain auth assembly described above.

### 2. Built-in client — `src/gateway/client.ts`

The **reference implementation** inside the `openclaw/openclaw` monorepo. This is what the protocol documentation cites for all client constants (timeouts, backoff, tick intervals, etc.).

- Used internally by the CLI and built-in web UI
- **Not published as a standalone package** — requires depending on the full `openclaw` npm package (heavy: 42 dependencies)
- GitHub issue [#49178](https://github.com/openclaw/openclaw/issues/49178) tracks extracting it into a standalone `@openclaw/gateway-client` SDK (not yet shipped)

### 3. `claw-sdk` (community)

A pure TypeScript SDK focused specifically on **active system calls** (exec commands, node invoke). Much narrower scope — not a full gateway client. Community open-source project.

### 4. Go client — `openclaw-go/gateway`

For non-JS projects: a typed Go client ([github.com/a3tai/openclaw-go/gateway](https://pkg.go.dev/github.com/a3tai/openclaw-go/gateway)) with generated protocol types and full RPC method coverage.
