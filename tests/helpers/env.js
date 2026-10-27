// src/config/env.js throws on import if any required variable is missing, so
// anything reaching it needs these set first.
//
// Set here rather than by loading .env, so the suite passes on a clean clone
// with no environment file at all. Only the tests that genuinely need env.js
// import this — the rest of the suite touches nothing.
//
// Import this module, then `await import()` the module under test. A static
// import would be hoisted above the assignments and defeat the point.
const REQUIRED = {
  DB_SERVER: "test-server",
  DB_USER: "test-user",
  DB_PASSWORD: "test-password",
  DB_NAME: "test-db",
  DB_PORT: "1433",
  JWT_SECRET: "test-secret-not-used-anywhere-real",
  SMTP_USER: "test@example.com",
  AZURE_CLIENT_ID: "test-client-id",
  AZURE_TENANT_ID: "test-tenant-id",
  AZURE_CLIENT_SECRET: "test-client-secret",
  SMTP_HOST: "smtp.example.com",
  SMTP_PORT: "587",
  CORS_ORIGIN: "http://localhost:5173",
  NODE_ENV: "test",
  DB_TRUST_SERVER_CERTIFICATE: "false",
  DB_ENCRYPT: "false",
  APP_URL: "http://localhost:5173",
};

for (const [name, value] of Object.entries(REQUIRED)) {
  process.env[name] ??= value;
}

export const JWT_SECRET = process.env.JWT_SECRET;
