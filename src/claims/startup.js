import { describeKeys, parseKeyHashes } from "../middlewares/integrationAuth.js";
import { assertIntegrationNetwork } from "../middlewares/integrationNetwork.js";
import { assertClaimDetailsAllowed, claimDetailsOn } from "./detailsStore.js";

// What server.js checks, and says, at start about the claim details store and the hand-off API. Kept
// here rather than in server.js so a test can run it: server.js opens the database.
//
// It throws, and the server does not start, for a switch on in production, a malformed
// INTEGRATION_API_KEY_HASHES or INTEGRATION_ALLOWED_IPS, "trust proxy" true, and a key with no
// allowed address. It does so whenever the hand-off API is on, in every NODE_ENV: the store is never
// on in production and UAT runs as development, so a check that waited for production would never run.
// Returns true when the API is on.
export const checkIntegrationAtStart = ({
  trustProxy,
  nodeEnv = process.env.NODE_ENV,
  log = console.log,
  warn = console.warn,
} = {}) => {
  assertClaimDetailsAllowed();
  if (!claimDetailsOn()) return false;

  warn(
    "CLAIM_DETAILS_DEV_STORE is on: the details of claims and their hand-off state are kept in a file, not in the database. That file holds the names and numbers of claimants and the cause of a death in plain text: use it on your own machine only.",
  );

  const keys = parseKeyHashes(process.env.INTEGRATION_API_KEY_HASHES);
  if (keys.length === 0) warn("INTEGRATION_API_KEY_HASHES is empty, so every call to the claims hand-off API will be refused.");

  const { lines, warnings } = describeKeys(keys);
  for (const line of lines) log(`Integration key: ${line}`);
  for (const warning of warnings) warn(warning);

  const sources = assertIntegrationNetwork({
    nodeEnv,
    allowedIps: process.env.INTEGRATION_ALLOWED_IPS,
    trustProxy,
    keyCount: keys.length,
  });

  if (sources === 0) warn("INTEGRATION_ALLOWED_IPS is empty, so nobody can reach the claims hand-off API.");
  else log(`Integration allowed from ${sources} listed address(es) or range(s).`);

  return true;
};

export default { checkIntegrationAtStart };
