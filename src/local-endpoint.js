const LOCAL_HOSTNAMES = new Set([
  "localhost",
  "host.docker.internal",
  "gateway.docker.internal",
]);

export class LocalEndpointError extends Error {
  constructor(message, code = "INVALID_LOCAL_ENDPOINT") {
    super(message);
    this.name = "LocalEndpointError";
    this.code = code;
  }
}

function parseIpv4(hostname) {
  const pieces = hostname.split(".");
  if (pieces.length !== 4 || pieces.some((piece) => !/^\d{1,3}$/.test(piece))) {
    return null;
  }

  const octets = pieces.map(Number);
  if (octets.some((octet) => octet < 0 || octet > 255)) {
    return null;
  }

  return octets;
}

function isPrivateIpv4(octets) {
  const [first, second] = octets;
  return (
    first === 10 ||
    first === 127 ||
    (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254)
  );
}

function isPrivateIpv6(hostname) {
  const normalized = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (normalized === "::1") return true;

  if (normalized.startsWith("::ffff:")) {
    const mapped = parseIpv4(normalized.slice("::ffff:".length));
    return mapped ? isPrivateIpv4(mapped) : false;
  }

  const firstGroup = normalized.split(":", 1)[0];
  if (!/^[0-9a-f]{2,4}$/.test(firstGroup)) return false;

  const value = Number.parseInt(firstGroup, 16);
  return (value & 0xfe00) === 0xfc00 || (value & 0xffc0) === 0xfe80;
}

function normalizedHostname(hostname) {
  return hostname.replace(/^\[|\]$/g, "").toLowerCase().replace(/\.$/, "");
}

function isLoopbackHostname(hostname) {
  const normalized = normalizedHostname(hostname);
  if (normalized === "localhost" || normalized.endsWith(".localhost")) return true;

  const ipv4 = parseIpv4(normalized);
  if (ipv4) return ipv4[0] === 127;
  if (normalized === "::1") return true;

  if (normalized.startsWith("::ffff:")) {
    const mapped = parseIpv4(normalized.slice("::ffff:".length));
    return mapped?.[0] === 127;
  }

  return false;
}

export function isLocalHostname(hostname) {
  const normalized = normalizedHostname(hostname);
  if (LOCAL_HOSTNAMES.has(normalized) || normalized.endsWith(".localhost") || normalized.endsWith(".local")) {
    return true;
  }

  const ipv4 = parseIpv4(normalized);
  if (ipv4) return isPrivateIpv4(ipv4);
  return normalized.includes(":") && isPrivateIpv6(normalized);
}

/**
 * Chromium's Local Network Access permission is keyed to the destination's
 * address space. Supplying it explicitly makes HTTPS -> LAN/loopback requests
 * deterministic, including hostnames whose DNS result is not known up front.
 * Browsers that do not implement the experimental RequestInit member ignore it.
 */
export function targetAddressSpaceForEndpoint(input) {
  const parsed = new URL(normalizeLocalServiceUrl(input));
  return isLoopbackHostname(parsed.hostname) ? "loopback" : "local";
}

export function localNetworkPermissionNameForEndpoint(input) {
  return targetAddressSpaceForEndpoint(input) === "loopback"
    ? "loopback-network"
    : "local-network";
}

export function localFetchOptions(endpoint, options = {}) {
  return {
    ...options,
    mode: options.mode ?? "cors",
    credentials: options.credentials ?? "omit",
    targetAddressSpace: targetAddressSpaceForEndpoint(endpoint),
  };
}

export async function localNetworkPermissionState(endpoint, permissions = globalThis.navigator?.permissions) {
  if (!permissions?.query) return "unsupported";
  const permissionNames = [localNetworkPermissionNameForEndpoint(endpoint), "local-network-access"];
  for (const name of permissionNames) {
    try {
      const status = await permissions.query({ name });
      if (["granted", "denied", "prompt"].includes(status?.state)) return status.state;
    } catch {
      // Older Chromium builds only recognize the combined compatibility alias.
    }
  }
  return "unsupported";
}

function withDefaultProtocol(value) {
  const trimmed = value.trim();
  if (/^[a-z][a-z\d+.-]*:\/\//i.test(trimmed)) return trimmed;
  return `http://${trimmed}`;
}

export function normalizeLocalServiceUrl(input, options = {}) {
  if (typeof input !== "string" || input.trim() === "") {
    throw new LocalEndpointError(options.emptyMessage ?? "Enter a local service URL.", "EMPTY_ENDPOINT");
  }

  let parsed;
  try {
    parsed = new URL(withDefaultProtocol(input));
  } catch {
    throw new LocalEndpointError("The endpoint is not a valid URL.", "MALFORMED_ENDPOINT");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new LocalEndpointError("The endpoint must use http:// or https://.", "UNSUPPORTED_PROTOCOL");
  }

  if (parsed.username || parsed.password) {
    throw new LocalEndpointError("Credentials are not accepted in endpoint URLs.", "URL_CREDENTIALS");
  }

  if (parsed.hostname === "0.0.0.0" || parsed.hostname === "[::]") {
    throw new LocalEndpointError(
      "0.0.0.0 is a listen address, not a browser destination. Use localhost or the machine's LAN address.",
      "WILDCARD_HOST",
    );
  }

  if (!isLocalHostname(parsed.hostname)) {
    throw new LocalEndpointError(
      "Only localhost, .local names, loopback addresses, and private LAN addresses are allowed.",
      "NON_LOCAL_HOST",
    );
  }

  parsed.username = "";
  parsed.password = "";
  parsed.search = "";
  parsed.hash = "";
  if (typeof options.forcePath === "string") parsed.pathname = options.forcePath;
  else if ((!parsed.pathname || parsed.pathname === "/") && options.defaultPath) parsed.pathname = options.defaultPath;
  const result = parsed.toString();
  return options.keepTrailingSlash ? result : result.replace(/\/$/, "");
}

export function normalizeLocalEndpoint(input) {
  return normalizeLocalServiceUrl(input, {
    emptyMessage: "Enter a local OpenAI-compatible endpoint.",
    forcePath: "/v1",
  });
}

export function endpointResource(endpoint, resource) {
  const base = normalizeLocalEndpoint(endpoint);
  const suffix = String(resource).replace(/^\/+/, "");
  return `${base}/${suffix}`;
}

export function serviceResource(endpoint, resource) {
  const base = normalizeLocalServiceUrl(endpoint);
  const suffix = String(resource).replace(/^\/+/, "");
  return `${base}/${suffix}`;
}
