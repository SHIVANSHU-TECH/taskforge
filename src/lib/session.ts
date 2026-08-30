import { SignJWT, jwtVerify } from "jose";

/**
 * Edge-safe session helpers. This module imports ONLY `jose` and reads
 * process.env directly so it can run in Next.js middleware (edge runtime).
 * Do not import Prisma or Node-only code here.
 */

export const SESSION_COOKIE = "tf_session";
export const SESSION_MAX_AGE = 60 * 60 * 24 * 7; // 7 days
const ALG = "HS256";

export interface SessionPayload {
  sub: string; // user id
  email: string;
  role: string;
  orgId: string;
}

function secret(): Uint8Array {
  const s = process.env.AUTH_SECRET;
  if (!s || s.length < 32) {
    throw new Error("AUTH_SECRET is missing or shorter than 32 characters");
  }
  return new TextEncoder().encode(s);
}

export async function signSession(payload: SessionPayload): Promise<string> {
  return new SignJWT({ email: payload.email, role: payload.role, orgId: payload.orgId })
    .setProtectedHeader({ alg: ALG })
    .setSubject(payload.sub)
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE}s`)
    .sign(secret());
}

export async function verifySession(token: string): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, secret());
    if (typeof payload.sub !== "string" || typeof payload.email !== "string") {
      return null;
    }
    return {
      sub: payload.sub,
      email: payload.email,
      role: typeof payload.role === "string" ? payload.role : "viewer",
      orgId: typeof payload.orgId === "string" ? payload.orgId : "",
    };
  } catch {
    return null;
  }
}
