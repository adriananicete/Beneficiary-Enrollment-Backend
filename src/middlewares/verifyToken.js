import jwt from "jsonwebtoken";
import config from "../config/env.js";

export const verifyToken = (req, res, next) => {
  const { token } = req.cookies;

  if (!token)
    return res.status(401).json({ error: "Unauthorized: No token provided." });

  try {
    const decoded = jwt.verify(token, config.jwtSecret);

    req.user = decoded;

    next();
  } catch (error) {
    console.error(error);
    return res.status(401).json({ error: 'Invalid or expired token' });
  }
};
