export const SESSION_EXPIRY = 8 * 60 * 60 * 1000;
export const REMEMBER_ME_EXPIRY = 30 * 24 * 60 * 60 * 1000;

// The reset token is a key to one action rather than a session, which is why it
// is minutes and why `rememberMe` never applies to it. It was written as
// `15 * 60 * 1000` in both login controllers and as "15m" beside each one.
export const RESET_TOKEN_EXPIRY = 15 * 60 * 1000;

// Account lockout, agreed 2026-10-06: eight wrong passwords lock an account for
// fifteen minutes, then it unlocks by itself. Passed to
// sec.us01_usp_login_failed rather than written into it, so changing either
// needs no DBA.
export const LOGIN_MAX_ATTEMPTS = 8;
export const LOGIN_LOCK_MINUTES = 15;


export const SUPER_ADMIN = 'Administrator';
export const ADMIN = 'HR';
export const EMPLOYEE = 'Employee';
export const EMPLOYEE_ROLE_ID = 3;