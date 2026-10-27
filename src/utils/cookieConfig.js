import config from "../config/env.js";

export const cookieOptions = {
    httpOnly: true,
    secure: config.nodeEnv === 'production',
    sameSite: 'Strict'
}