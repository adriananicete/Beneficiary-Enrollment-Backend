// Segment matching also covers claim documents, reviews, counts and death claims.
// Claims are offered only where CLAIMS_ENABLED=true is set: a developer's own .env. UAT runs as
// development, so NODE_ENV cannot tell it from a developer's machine.
export const claimsEnabled = () => String(process.env.CLAIMS_ENABLED).trim().toLowerCase() === "true";

export const isClaimsPath = (path) =>
  path.split("/").some((segment) => ["claims", "claim-types", "death-claim"].includes(segment.toLowerCase()));

export const isClaimsBlocked = (path) => !claimsEnabled() && isClaimsPath(path);
