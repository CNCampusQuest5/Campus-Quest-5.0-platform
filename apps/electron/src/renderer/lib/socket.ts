import { io } from 'socket.io-client';

/**
 * Production API base:
 * 1. Injected at build time via main process: window.__CQ_API_URL__
 * 2. Compile-time VITE env var: VITE_API_URL
 * 3. Fallback to Render deployment (dev/staging only)
 */
export const API_BASE: string =
  (window as any).__CQ_API_URL__ ||
  import.meta.env.VITE_API_URL ||
  'https://campus-quest-backend-production-8cee.up.railway.app';

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
export const socket = io(API_BASE, {
  transports: ['websocket', 'polling'],
  autoConnect: false, // Don't connect until we have a JWT token
  reconnection: true,
  reconnectionAttempts: 30,
  reconnectionDelay: 2000,       // Start at 2s
  reconnectionDelayMax: 30000,   // Cap at 30s
  randomizationFactor: 0.4,      // Add jitter to avoid thundering herd
  timeout: 20000,                // 20s connection timeout
});

// Stores the JWT after login so workspace API calls can attach it
let _authToken: string | null = null;

export function getAuthToken(): string | null {
  return _authToken;
}

/**
 * Called after successful login.
 * Stores the JWT and connects/reconnects the socket with it.
 * Safe to call multiple times (e.g. after network switch).
 */
export function connectSocket(token: string): void {
  _authToken = token;
  (socket as any).auth = { token };
  if (socket.connected) {
    socket.disconnect();
  }
  socket.connect();
}
