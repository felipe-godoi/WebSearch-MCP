import { lookup } from "node:dns/promises";
import { isIP, isIPv4, isIPv6 } from "node:net";
import http from "node:http";
import https from "node:https";

export class SecurityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SecurityError";
  }
}

// Disallowed internal TLDs and suffix names
const INTERNAL_TLD_REGEX = /\.(local|localhost|internal|lan|home|corp|test|example|invalid|arpa)$/i;

// Standard web ports allowed for public web scraping
const ALLOWED_PORTS = new Set([80, 443, 8080, 8443]);

/**
 * Checks if an IPv4 address is within private, loopback, link-local, or reserved ranges.
 */
export function isPrivateIPv4(ip: string): boolean {
  const parts = ip.split(".").map((p) => parseInt(p, 10));
  if (parts.length !== 4 || parts.some((p) => isNaN(p) || p < 0 || p > 255)) {
    return true; // Malformed IPv4 is treated as unsafe
  }

  const [a, b, c] = parts;

  // 0.0.0.0/8 (Current network / default route)
  if (a === 0) return true;

  // 10.0.0.0/8 (Private network - used by Dokploy network 10.0.1.x)
  if (a === 10) return true;

  // 100.64.0.0/10 (Shared Address Space / CGNAT: 100.64.0.0 - 100.127.255.255)
  if (a === 100 && b >= 64 && b <= 127) return true;

  // 127.0.0.0/8 (Loopback)
  if (a === 127) return true;

  // 169.254.0.0/16 (Link-Local / Cloud Metadata e.g. 169.254.169.254)
  if (a === 169 && b === 254) return true;

  // 172.16.0.0/12 (Private network / Docker bridge networks: 172.16.0.0 - 172.31.255.255)
  if (a === 172 && b >= 16 && b <= 31) return true;

  // 192.0.0.0/24 (IETF Protocol Assignments)
  if (a === 192 && b === 0 && c === 0) return true;

  // 192.0.2.0/24 (TEST-NET-1)
  if (a === 192 && b === 0 && c === 2) return true;

  // 192.88.99.0/24 (6to4 Relay Anycast)
  if (a === 192 && b === 88 && c === 99) return true;

  // 192.168.0.0/16 (Private network)
  if (a === 192 && b === 168) return true;

  // 198.18.0.0/15 (Benchmarking: 198.18.0.0 - 198.19.255.255)
  if (a === 198 && (b === 18 || b === 19)) return true;

  // 198.51.100.0/24 (TEST-NET-2)
  if (a === 198 && b === 51 && c === 100) return true;

  // 203.0.113.0/24 (TEST-NET-3)
  if (a === 203 && b === 0 && c === 113) return true;

  // 224.0.0.0/4 (Multicast: 224.0.0.0 - 239.255.255.255)
  if (a >= 224 && a <= 239) return true;

  // 240.0.0.0/4 (Reserved / Future use: 240.0.0.0 - 255.255.255.255)
  if (a >= 240) return true;

  return false;
}

/**
 * Checks if an IPv6 address is within private, loopback, link-local, or reserved ranges.
 */
export function isPrivateIPv6(ip: string): boolean {
  const norm = ip.toLowerCase().trim();

  // Loopback (::1)
  if (norm === "::1" || norm === "0:0:0:0:0:0:0:1") return true;

  // Unspecified (::)
  if (norm === "::" || norm === "0:0:0:0:0:0:0:0") return true;

  // IPv4-mapped IPv6 (::ffff:192.0.2.128 or ::ffff:7f00:1)
  if (norm.startsWith("::ffff:") || norm.includes("::ffff:")) {
    const lastPart = norm.split(":").pop() || "";
    if (isIPv4(lastPart)) {
      return isPrivateIPv4(lastPart);
    }
    // Handle hex mapped representation
    const segments = norm.split(":");
    const h1 = parseInt(segments[segments.length - 2], 16);
    const h2 = parseInt(segments[segments.length - 1], 16);
    if (!isNaN(h1) && !isNaN(h2)) {
      const b1 = (h1 >> 8) & 0xff;
      const b2 = h1 & 0xff;
      const b3 = (h2 >> 8) & 0xff;
      const b4 = h2 & 0xff;
      return isPrivateIPv4(`${b1}.${b2}.${b3}.${b4}`);
    }
    return true;
  }

  // Link-Local (fe80::/10 -> fe80 to febf)
  if (/^fe[89ab]/i.test(norm)) return true;

  // Unique Local Address / ULA (fc00::/7 -> fc00 to fdff)
  if (/^f[cd]/i.test(norm)) return true;

  // Multicast (ff00::/8)
  if (norm.startsWith("ff")) return true;

  // Documentation (2001:db8::/32)
  if (norm.startsWith("2001:db8") || norm.startsWith("2001:0db8")) return true;

  // Discard prefix (100::/64)
  if (norm.startsWith("100:")) return true;

  return false;
}

/**
 * Checks if an IP string (v4 or v6) is private or reserved.
 */
export function isPrivateIP(ip: string): boolean {
  if (isIPv4(ip)) return isPrivateIPv4(ip);
  if (isIPv6(ip)) return isPrivateIPv6(ip);
  return true; // Not a recognized IP format
}

/**
 * Checks if a hostname is an internal / non-public name.
 */
export function isInternalHostname(hostname: string): boolean {
  const cleanHost = hostname.toLowerCase().trim().replace(/^\[|\]$/g, "");

  // If it is an IP literal
  if (isIP(cleanHost)) {
    return isPrivateIP(cleanHost);
  }

  // Localhost
  if (cleanHost === "localhost") return true;

  // Single-word hostnames (no dot) are internal Docker service names, local containers, or LAN names
  if (!cleanHost.includes(".")) {
    return true;
  }

  // Check known internal/reserved TLDs
  if (INTERNAL_TLD_REGEX.test(cleanHost)) {
    return true;
  }

  return false;
}

/**
 * Resolves a hostname via DNS and verifies that NONE of the resolved IP addresses are private.
 */
export async function assertPublicDnsResolution(hostname: string): Promise<string[]> {
  const cleanHost = hostname.toLowerCase().trim().replace(/^\[|\]$/g, "");

  if (isInternalHostname(cleanHost)) {
    throw new SecurityError(
      `Access to internal or local hostname "${hostname}" is forbidden (SSRF protection).`
    );
  }

  try {
    const records = await lookup(cleanHost, { all: true, verbatim: true });
    if (!records || records.length === 0) {
      throw new SecurityError(`Failed to resolve hostname "${hostname}".`);
    }

    const resolvedIps = records.map((r) => r.address);

    for (const ip of resolvedIps) {
      if (isPrivateIP(ip)) {
        throw new SecurityError(
          `Security violation: Hostname "${hostname}" resolved to private/internal IP address "${ip}". Access is blocked (SSRF protection).`
        );
      }
    }

    return resolvedIps;
  } catch (err: any) {
    if (err instanceof SecurityError) throw err;
    throw new SecurityError(
      `DNS lookup failed for "${hostname}": ${err.message || "Unknown error"}`
    );
  }
}

/**
 * Validates that a raw URL is a safe, public, external HTTP/HTTPS destination.
 * Checks protocol, credentials, port, hostname, and DNS resolution.
 */
export async function assertSafePublicUrl(rawUrl: string): Promise<URL> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch (e: any) {
    throw new SecurityError(`Invalid URL format: "${rawUrl}"`);
  }

  // 1. Protocol check: only http and https allowed
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SecurityError(
      `Forbidden protocol "${parsed.protocol}". Only "http:" and "https:" are allowed.`
    );
  }

  // 2. Reject credentials in URL (used in obfuscation attacks)
  if (parsed.username || parsed.password) {
    throw new SecurityError("URLs containing user credentials are not allowed.");
  }

  // 3. Port check
  const port = parsed.port ? parseInt(parsed.port, 10) : parsed.protocol === "https:" ? 443 : 80;
  if (isNaN(port) || !ALLOWED_PORTS.has(port)) {
    throw new SecurityError(
      `Port ${port} is not allowed. Only standard web ports (80, 443, 8080, 8443) are permitted.`
    );
  }

  // 4. Hostname validation
  const hostname = parsed.hostname;
  if (!hostname) {
    throw new SecurityError("URL is missing a valid hostname.");
  }

  // 5. DNS and IP verification
  await assertPublicDnsResolution(hostname);

  return parsed;
}

/**
 * Returns true if the URL is a safe public URL, false otherwise.
 */
export async function isSafePublicUrl(rawUrl: string): Promise<boolean> {
  try {
    await assertSafePublicUrl(rawUrl);
    return true;
  } catch {
    return false;
  }
}

/**
 * Follows HTTP redirects up to maxRedirects, verifying every intermediate hop
 * to protect against Open Redirect SSRF attacks.
 */
export async function resolveAndValidateFinalUrl(
  initialUrl: string,
  maxRedirects = 5
): Promise<string> {
  let currentUrl = initialUrl;

  for (let i = 0; i < maxRedirects; i++) {
    const parsed = await assertSafePublicUrl(currentUrl);

    // Make a HEAD or GET request without auto-following redirects to inspect the Location header
    const nextLocation = await new Promise<string | null>((resolve) => {
      const isHttps = parsed.protocol === "https:";
      const client = isHttps ? https : http;

      const req = client.request(
        parsed,
        {
          method: "HEAD",
          timeout: 4000,
          headers: {
            "User-Agent":
              "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
          },
        },
        (res) => {
          res.resume(); // Discard body
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location
          ) {
            resolve(res.headers.location);
          } else {
            resolve(null);
          }
        }
      );

      req.on("error", () => resolve(null));
      req.on("timeout", () => {
        req.destroy();
        resolve(null);
      });
      req.end();
    });

    if (!nextLocation) {
      // No redirect or request finished; currentUrl is the final destination
      return currentUrl;
    }

    // Resolve relative or absolute redirect URL
    const nextResolvedUrl = new URL(nextLocation, currentUrl).href;
    // Validate next hop immediately
    await assertSafePublicUrl(nextResolvedUrl);
    currentUrl = nextResolvedUrl;
  }

  return currentUrl;
}
