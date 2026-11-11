// Makes a key for IPS and the hash this server keeps (md/IPS-INTEGRATION-DECISIONS.md).
// `npm run ips-key`. Nothing is written anywhere: the key is shown once, here.
import { hashKey, newKey } from "../src/utils/integrationKeys.js";

const key = newKey();

console.log("Key, for IPS. Give it to them once, over a safe channel, and do not keep a copy:");
console.log(`  ${key}`);
console.log("");
console.log("Hash, for this server. Add it to IPS_API_KEY_HASHES (comma-separated) and restart:");
console.log(`  ${hashKey(key)}`);
