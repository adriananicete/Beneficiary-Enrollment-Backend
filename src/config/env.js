const envVar = [
  "DB_SERVER",
  "DB_USER",
  "DB_PASSWORD",
  "DB_NAME",
  "DB_PORT",
  "JWT_SECRET",
  "SMTP_HOST",
  "SMTP_PORT",
  "SMTP_USER",
  "SMTP_CLIENT_ID",
  "SMTP_TENANT_ID",
  "SMTP_CLIENT_SECRET",
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
  },
  jwtSecret: process.env.JWT_SECRET,
  smtp: {
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT),
    user: process.env.SMTP_USER,
    clientId: process.env.SMTP_CLIENT_ID,
    tenantId: process.env.SMTP_TENANT_ID,
    clientSecret: process.env.SMTP_CLIENT_SECRET,
  },
};

export default config;
