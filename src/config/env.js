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
  // How many invitation emails are in flight at once. Microsoft Graph limits
  // concurrent sends per mailbox, so this is deliberately small. Optional, and
  // kept out of the required list above so existing .env files keep working.
  invitationConcurrency: Number(process.env.INVITATION_CONCURRENCY) || 4,
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
