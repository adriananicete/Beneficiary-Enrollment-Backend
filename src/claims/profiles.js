// Which form a claim type is filed with. The claims form asks different things for a death, a
// disability, a terminal illness and a dismemberment, and the type's code is how the backend
// knows which (docs/claims-details/CONTRACT.md, "The four claim types and their profiles").
// One table, so the frontend and the details schema cannot disagree about it.
//
// The code is read from claim_types.claim_type_code, so the DBA's four rows
// (CLAIM-DETAILS-DBA-REQUEST.md) are what switch the forms on. The three TEST-* types, and any
// type added later, are "general": documents only, as claims have always been.
export const GENERAL = "general";

export const PROFILES = {
  DEATH: "death",
  TPD: "tpd",
  TERMINAL_ILLNESS: "terminal_illness",
  DISMEMBERMENT: "dismemberment",
};

// Text only: hasOwn would turn ["DEATH"] into "DEATH" and answer death.
export const profileOf = (claimTypeCode) =>
  typeof claimTypeCode === "string" && Object.hasOwn(PROFILES, claimTypeCode) ? PROFILES[claimTypeCode] : GENERAL;

export default { GENERAL, PROFILES, profileOf };
