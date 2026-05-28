export const COOKIE_NAME = "flatroad_admin_session";

const SECRET = process.env.ADMIN_SESSION_SECRET ?? "flatroad-admin-2024-secret";
const ADMIN_ID = process.env.ADMIN_ID ?? "root";
const ADMIN_PW = process.env.ADMIN_PW ?? "1234";
const API_BASE = process.env.NEXT_PUBLIC_API_BASE_URL?.replace(/\/$/, "") ?? "";
const PAYLOAD = "auth";

async function hmacSign(data: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(SECRET),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(data));
  return Array.from(new Uint8Array(sig))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function createSessionToken(): Promise<string> {
  const sig = await hmacSign(PAYLOAD);
  return `${PAYLOAD}.${sig}`;
}

export async function verifySessionToken(token: string): Promise<boolean> {
  const dot = token.indexOf(".");
  if (dot === -1) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (payload !== PAYLOAD) return false;
  const expected = await hmacSign(payload);
  return sig === expected;
}

export async function validateCredentials(id: string, pw: string): Promise<boolean> {
  if (API_BASE) {
    try {
      const res = await fetch(`${API_BASE}/admin/auth/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, pw }),
        cache: "no-store",
      });
      if (res.ok) return true;
    } catch {
      // Fall back to env credentials for local/offline admin access.
    }
  }
  return id === ADMIN_ID && pw === ADMIN_PW;
}
