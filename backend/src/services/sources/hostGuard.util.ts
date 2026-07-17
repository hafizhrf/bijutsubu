import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { env } from "../../config/env.js";

/**
 * SSRF guard for user-supplied database hosts. When SOURCE_ALLOW_PRIVATE_HOSTS
 * is "false" (SaaS posture), the hostname is resolved FIRST and every resolved
 * address must be public — otherwise connecting is refused before any socket
 * is opened. Self-hosted installs default to allowing private hosts because
 * connecting to localhost databases is the primary use case.
 */

function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 6) {
    const lower = address.toLowerCase();
    return (
      lower === "::1" ||
      lower.startsWith("fe80:") || // link-local
      lower.startsWith("fc") || // unique-local fc00::/7
      lower.startsWith("fd") ||
      lower.startsWith("::ffff:") // v4-mapped — re-check the embedded v4
    );
  }
  const octets = address.split(".").map(Number);
  if (octets.length !== 4 || octets.some((n) => Number.isNaN(n))) return true;
  const [a, b] = octets;
  return (
    a === 127 || // loopback
    a === 10 || // RFC1918
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) || // link-local incl. cloud metadata
    a === 0
  );
}

/** Throws Error("private_host_blocked") when the guard rejects the host. */
export async function assertHostAllowed(host: string): Promise<void> {
  if (env.SOURCE_ALLOW_PRIVATE_HOSTS) return;
  const addresses =
    isIP(host) !== 0 ? [host] : (await lookup(host, { all: true })).map((entry) => entry.address);
  if (addresses.length === 0 || addresses.some((address) => isPrivateAddress(address))) {
    throw new Error("private_host_blocked");
  }
}
