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

const config = {
  PORT: process.env.PORT || 7000,
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
