export const SESSION_EXPIRY = 8 * 60 * 60 * 1000;
export const REMEMBER_ME_EXPIRY = 30 * 24 * 60 * 60 * 1000;

// The reset token is a key to one action rather than a session, which is why it
// is minutes and why `rememberMe` never applies to it. It was written as
// `15 * 60 * 1000` in both login controllers and as "15m" beside each one.
export const RESET_TOKEN_EXPIRY = 15 * 60 * 1000;


export const SUPER_ADMIN = 'Administrator';
export const ADMIN = 'HR';
export const EMPLOYEE = 'Employee';
export const EMPLOYEE_ROLE_ID = 3;