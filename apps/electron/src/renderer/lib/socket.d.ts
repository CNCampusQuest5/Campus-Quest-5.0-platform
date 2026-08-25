/**
 * API base:
 * 1. Injected at runtime via main process: window.__CQ_API_URL__
 * 2. Compile-time VITE env var: VITE_API_URL
 * 3. Fallback to Railway deployment
 */
export declare const API_BASE: string;
/**
 * Single socket instance for the entire app lifetime.
 * Starts disconnected — connectSocket() is called after login with a valid JWT.
 *
 * Transport strategy:
 *  - ['websocket', 'polling'] — tries WebSocket first, falls back to HTTP polling
 *    so contestants on restrictive campus Wi-Fi that blocks raw WS upgrades still work.
 * Reconnect strategy:
 *  - Up to 30 retries with exponential backoff (2-30s), matching typical
 *    hotspot switch delays (phone auth gate, DHCP assignment, etc.)
 */
export declare const socket: import("socket.io-client").Socket<import("@socket.io/component-emitter").DefaultEventsMap, import("@socket.io/component-emitter").DefaultEventsMap>;
export declare function getAuthToken(): string | null;
/**
 * Called after successful login.
 * Stores the JWT and connects/reconnects the socket with it.
 * Safe to call multiple times (e.g. after network switch).
 */
export declare function connectSocket(token: string): void;
//# sourceMappingURL=socket.d.ts.map