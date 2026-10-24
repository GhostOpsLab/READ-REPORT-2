// Password hashing, signed session tokens and cookie helpers. Node built-ins only.
import { scryptSync, randomBytes, timingSafeEqual, createHmac } from "node:crypto";

export function hashPassword(password) {
  const salt = randomBytes(16);
  const hash = scryptSync(password, salt, 64);
  return `scrypt$${salt.toString("base64")}$${hash.toString("base64")}`;
}

export function verifyPassword(password, stored) {
  try {
    const [alg, s, h] = String(stored).split("$");
    if (alg !== "scrypt") return false;
    const salt = Buffer.from(s, "base64");
    const expected = Buffer.from(h, "base64");
    const got = scryptSync(password, salt, expected.length);
    return timingSafeEqual(got, expected);
  } catch {
    return false;
  }
}

export function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) {
    timingSafeEqual(ba, ba);
    return false;
  }
  return timingSafeEqual(ba, bb);
}

export function signToken(payload, secret) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = createHmac("sha256", secret).update(body).digest("base64url");
  return `${body}.${sig}`;
}

export function verifyToken(token, secret) {
  if (!token || typeof token !== "string") return null;
  const i = token.indexOf(".");
  if (i < 1) return null;
  const body = token.slice(0, i);
  const sig = token.slice(i + 1);
  const expected = createHmac("sha256", secret).update(body).digest("base64url");
  if (!safeEqual(sig, expected)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString());
    if (!payload.exp || payload.exp < Date.now() / 1000) return null;
    return payload;
  } catch {
    return null;
  }
}

export function parseCookies(header) {
  const out = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  }
  return out;
}

export function sessionCookie(token, maxAgeSeconds) {
  return `session=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=${maxAgeSeconds}`;
}

export const USERNAME_RE = /^[a-z0-9][a-z0-9._-]{2,29}$/;
