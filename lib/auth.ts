/**
 * Single-password gate. Set APP_PASSWORD and the whole app is behind it;
 * leave it blank (the default) and there is no gate at all.
 *
 * Deliberately tiny: one workspace, one operator. Swap for a real provider
 * when Cadence becomes multi-tenant.
 */

export const AUTH_COOKIE = "cadence_auth";

/** Web Crypto so the same helper works in middleware and in route handlers. */
export async function tokenFor(password: string): Promise<string> {
  const data = new TextEncoder().encode(`cadence:${password}`);
  const digest = await crypto.subtle.digest("SHA-256", data);
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
