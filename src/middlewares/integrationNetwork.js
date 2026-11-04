import net from "node:net";
import { AppError } from "../utils/AppError.js";

// Where the hand-off API may be reached from, and over what (docs/claims-details/CONTRACT.md,
// "Security of the hand-off API"). Two layers of the router, and the checks the server makes at start.
//
// INTEGRATION_ALLOWED_IPS lists the addresses and ranges of the claims web app's server, as
// "10.1.2.3,10.1.4.0/24,fd00::/8". IIS restricts the path to the same address; this is the second
// layer, so a mistake in the first does not open it.
//
// These apply whenever the hand-off API is on, in every NODE_ENV. The development store is never on
// in production, and UAT runs as development, so a rule that waited for "production" would never
// apply where the API can run.

const DENY_ALL = new net.BlockList();

const LOOPBACK = new net.BlockList();
LOOPBACK.addSubnet("127.0.0.0", 8, "ipv4");
LOOPBACK.addAddress("::1", "ipv6");

// { list, count }. Throws on an entry that is not an address or a range, naming its place. The
// entries are not secret, but a typo is easier to find by position.
export const parseAllowedIps = (value) => {
  const list = new net.BlockList();
  if (typeof value !== "string" || value.trim() === "") return { list, count: 0 };

  const entries = value.split(",");

  entries.forEach((raw, index) => {
    const [address, prefix, ...rest] = raw.trim().split("/");
    const family = net.isIP(address);
    const bits = prefix === undefined ? null : /^\d{1,3}$/.test(prefix) ? Number(prefix) : NaN;
    const widest = family === 4 ? 32 : 128;

    // A zone ("fe80::1%eth0") names an interface of this machine, not a source on the network.
    if (!family || address.includes("%") || rest.length > 0 || (bits !== null && !(bits >= 0 && bits <= widest)))
      throw new Error(`INTEGRATION_ALLOWED_IPS entry ${index + 1} is not an IP address or a CIDR range`);

    const type = family === 4 ? "ipv4" : "ipv6";

    if (bits === null) list.addAddress(address, type);
    else list.addSubnet(address, bits, type);
  });

  return { list, count: entries.length };
};

// Read again only when the variable changes. An empty list allows nobody, and so does a malformed
// one: failing closed is the safe way to fail, and the server checks the setting once at start and
// refuses to boot on it. There is no "this machine only" default: behind a proxy on the same host
// every caller can look like 127.0.0.1, so a developer who wants loopback writes it down.
let held = { source: null, list: DENY_ALL };

const allowedList = () => {
  const source = process.env.INTEGRATION_ALLOWED_IPS ?? "";

  if (held.source !== source) {
    try {
      held = { source, list: parseAllowedIps(source).list };
    } catch (error) {
      console.error(error.message);
      held = { source, list: DENY_ALL };
    }
  }

  return held.list;
};

const MAPPED = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i;

// The caller's address as Express resolved it (it follows "trust proxy"), with an IPv4 address that
// arrived in its IPv6 form ("::ffff:10.1.2.3") written as IPv4, for the log and the limiter.
export const sourceOf = (req) => {
  const ip = typeof req.ip === "string" ? req.ip : "";

  return MAPPED.exec(ip)?.[1] ?? (ip || "unknown");
};

const isListed = (list, address) => {
  const family = net.isIP(address);
  if (!family) return false;

  try {
    return list.check(address, family === 4 ? "ipv4" : "ipv6");
  } catch {
    return false;
  }
};

// A source that is not listed leaves the router, so the request ends in the 404 of a path that was
// never declared, the same as when the switch is off. A 401 or 403 would say the API is there.
export const onlyFromAllowedSources = (req, res, next) =>
  isListed(allowedList(), sourceOf(req)) ? next() : next("router");

// HTTPS for every source but this machine, in every NODE_ENV: the package holds health information
// and identity documents. Loopback is exempt so a developer can use curl over http. req.secure
// follows "trust proxy", so behind IIS the setting must be a hop count and the proxy must send
// X-Forwarded-Proto. With IIS on the same host and "trust proxy" unset, every caller looks like
// loopback and this check lets plain HTTP through: set TRUST_PROXY.
export const requireHttps = (req, res, next) =>
  req.secure || isListed(LOOPBACK, sourceOf(req)) ? next() : next(new AppError("HTTPS is required.", 403));

// What the server checks at start while the hand-off API is on. Returns how many entries the list
// has. `keyCount` is how many keys INTEGRATION_API_KEY_HASHES holds.
export const assertIntegrationNetwork = ({ nodeEnv, allowedIps, trustProxy, keyCount = 0 }) => {
  const { count } = parseAllowedIps(allowedIps);

  // With true, Express believes the client-supplied X-Forwarded-For, so any caller could choose the
  // address this list is compared with. env.js already refuses TRUST_PROXY=true; this holds if the
  // setting is ever made another way.
  if (trustProxy === true)
    throw new Error('"trust proxy" must not be true while the hand-off API is on: any caller could choose its own source address.');

  // A key with nowhere to come from would be a key that opens nothing, or, if the list were taken to
  // mean "anywhere", one that opens everything. Production lists an address whether or not there are
  // keys yet.
  if (count === 0 && (keyCount > 0 || nodeEnv === "production"))
    throw new Error(
      "INTEGRATION_ALLOWED_IPS must list the address of the claims web app's server while the hand-off API has a key " +
        "(on your own machine: 127.0.0.1,::1). An empty list allows nobody.",
    );

  return count;
};

export default { parseAllowedIps, sourceOf, onlyFromAllowedSources, requireHttps, assertIntegrationNetwork };
