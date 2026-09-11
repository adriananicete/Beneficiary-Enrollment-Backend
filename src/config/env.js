const envVar = [
  "DB_SERVER",
  "DB_USER",
  "DB_PASSWORD",
  "DB_NAME",
  "DB_PORT",
  "JWT_SECRET",
  "SMTP_USER",
  "AZURE_CLIENT_ID",
  "AZURE_TENANT_ID",
  "AZURE_CLIENT_SECRET",
  "SMTP_HOST",
  "SMTP_PORT",
  "CORS_ORIGIN",
  "NODE_ENV",
  "DB_TRUST_SERVER_CERTIFICATE",
  "DB_ENCRYPT",
  "APP_URL"
];

for (let i of envVar) {
  if (!process.env[i])
    throw new Error(`Missing required environment variable: ${i}`);
}

 if(process.env.NODE_ENV === 'production' && process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0')
    throw new Error('NODE_TLS_REJECT_UNAUTHORIZED must not be 0 in production. It disables TLS certificate verification for the entire process, including the database connection and the credential email.')

// A development URL reaching production is the quiet kind of misconfiguration,
// and APP_URL is the worst of them.
//
// Every invitation email is built from it. Left at a local address, the send
// succeeds, the status is recorded as `sent`, and the recipient is pointed at a
// machine that is not theirs. Every part reports success and nobody can enrol —
// the only way to find out is an employee saying so. CORS_ORIGIN is the same
// mistake but a loud one: the frontend fails in the browser within a minute.
//
// Refusing to start is the point. A server that will not boot is a five-minute
// problem; a server that boots and sends a thousand dead links is not.
// TRUST_PROXY decides what req.ip means, and it is read in two places that
// matter for different reasons.
//
// enrollmentController.js:15 writes it onto every consent record. If production
// sits behind a reverse proxy and this is wrong, every data subject appears to
// have consented from the same address — which proves nothing about who
// consented, and cannot be recovered afterwards. BUSINESS-REQUIREMENTS §4.5.
//
// rateLimiter.js keys five limiters on it. Wrong here collapses every caller
// into one bucket, which is recoverable later; the consent record is not.
//
// It was `false` hardcoded in server.js with the comment "no reverse proxy in
// dev" — correct for dev and silently wrong for production, in the way that
// does not announce itself. The value is now required in production and the
// server refuses to start without it, the same treatment APP_URL got in PR #85.
//
// The accepted values are a hop count, or `false`. `true` is refused on
// purpose: it trusts a client-supplied X-Forwarded-For, so anyone can put any
// address on their own consent record just by sending a header.
const parseTrustProxy = (raw) => {
    if (raw === undefined || raw === '') return undefined;
    if (raw === 'false') return false;

    if (raw === 'true')
        throw new Error(
            'TRUST_PROXY must not be true. `true` trusts a client-supplied X-Forwarded-For header, ' +
            'so any caller could choose the IP address recorded on their own consent record. ' +
            'Set it to the number of proxies in front of this server — usually 1 — or to false if there are none.',
        );

    const hops = Number(raw);

    if (!Number.isInteger(hops) || hops < 0)
        throw new Error(
            `TRUST_PROXY must be a whole number of proxy hops, or false. Received "${raw}".`,
        );

    return hops;
};

const trustProxy = parseTrustProxy(process.env.TRUST_PROXY);

// Not in the required list above, because development should keep working
// without it. Production is where the silent default is dangerous.
if (process.env.NODE_ENV === 'production' && trustProxy === undefined)
    throw new Error(
        'TRUST_PROXY must be set in production. It decides what req.ip resolves to, which is ' +
        'written onto every consent record and used to key the rate limiters. Left unset it ' +
        'defaults to no proxy, and if there is one then every consent record stores the proxy ' +
        'address instead of the employee\'s — which is not recoverable after the fact. ' +
        'Set it to the number of proxies in front of this server, or to false if there are none.',
    );

const DEV_HOSTS = ['localhost', '127.0.0.1', '0.0.0.0'];

const pointsAtDevHost = (value) =>
    DEV_HOSTS.some((host) => String(value).includes(host));

if(process.env.NODE_ENV === 'production') {
    for (const name of ['APP_URL', 'CORS_ORIGIN']) {
        if(pointsAtDevHost(process.env[name]))
            throw new Error(
                `${name} points at a local address (${process.env[name]}) and NODE_ENV is production. ` +
                (name === 'APP_URL'
                    ? 'Every invitation email is built from this, so the send would succeed and the link would be unreachable for the person who received it.'
                    : 'The frontend would be refused by CORS on every request.'),
            );
    }
}

const config = {
  PORT: process.env.PORT || 7000,
  // false when unset, which is the old hardcoded behaviour — but production
  // can no longer reach here unset, because the guard above refuses to start.
  trustProxy: trustProxy ?? false,
  // How many invitation emails are in flight at once. Microsoft Graph limits
  // concurrent sends per mailbox, so this is deliberately small. Optional, and
  // kept out of the required list above so existing .env files keep working.
  invitationConcurrency: Number(process.env.INVITATION_CONCURRENCY) || 4,
  // A PNG or JPEG of the signatory's signature, printed above their name on the
  // Certificate of Coverage. Optional: unset, the certificate carries the name
  // alone, which is what the business has asked for until the image exists.
  //
  // A path on the server rather than a file in the repository, on purpose. It
  // is a real executive's signature, and a copy in git is a clean specimen for
  // anybody with read access, forever — deleting it later does not remove it
  // from history.
  certificateSignaturePath: process.env.CERTIFICATE_SIGNATURE_PATH || null,
  db: {
    server: process.env.DB_SERVER,
    port: Number(process.env.DB_PORT),
    name: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    encrypt: process.env.DB_ENCRYPT === 'true',
    trustServerCertificate: process.env.DB_TRUST_SERVER_CERTIFICATE === 'true'
  },
  jwtSecret: process.env.JWT_SECRET,
  corsOrigin: process.env.CORS_ORIGIN,
  appUrl: process.env.APP_URL,
  nodeEnv: process.env.NODE_ENV,
  smtp: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    user: process.env.SMTP_USER,
    clientId: process.env.AZURE_CLIENT_ID,
    tenantId: process.env.AZURE_TENANT_ID,
    clientSecret: process.env.AZURE_CLIENT_SECRET,
  },
};

export default config;
