// Segment matching also covers claim documents, reviews, counts and death claims.
export const isClaimsPath = (path) =>
  path.split("/").some((segment) => ["claims", "claim-types", "death-claim"].includes(segment.toLowerCase()));
