import bcrypt from "bcryptjs";

const ROUNDS = 10;

/**
 * A precomputed bcrypt hash used to equalize timing when authenticating a
 * non-existent user. Comparing against this (instead of returning early) keeps
 * the failure path's cost close to the success path, mitigating username
 * enumeration via response timing. It is not a real credential.
 */
export const DUMMY_PASSWORD_HASH =
  "$2a$10$pi6fRjhA3K3SE1osypUUAefOv9kecJslpK5KjjYIADXEiU4xOvJCi";

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
