import { claimDetailsOn } from "./detailsStore.js";

// Which form a claim type is filed with. The claims form asks different things for a death, a
// disability, a terminal illness and a dismemberment, and the type's code is how the backend
// knows which (docs/claims-details/CONTRACT.md, "The four claim types and their profiles").
// One table, so the frontend and the details schema cannot disagree about it.
//
// The code is read from claim_types.claim_type_code, so the DBA's four rows
// (CLAIM-DETAILS-DBA-REQUEST.md) are what switch the forms on. Any other type is "general":
// documents only, as claims have always been.
export const GENERAL = "general";

export const PROFILES = {
  DEATH: "death",
  // the death claim HR files for an employee already marked deceased: HR's own type, since a type is
  // filed by one of the two
  DEATH_HR: "death",
  TPD: "tpd",
  TERMINAL_ILLNESS: "terminal_illness",
  DISMEMBERMENT: "dismemberment",
};

// While the development store is on, the database still has only its three TEST-* claim types, so
// they stand in for three of the forms and the real ones can be tried. They keep their own names, and
// the real codes above take over when the DBA adds them. The store refuses to start in production, so
// this never applies there.
const DEV_STAND_INS = { "TEST-DEATH": PROFILES.DEATH, "TEST-END": PROFILES.TPD, "TEST-CLAIM": PROFILES.DISMEMBERMENT };

// Text only: hasOwn would turn ["DEATH"] into "DEATH" and answer death.
export const profileOf = (claimTypeCode) => {
  if (typeof claimTypeCode !== "string") return GENERAL;
  if (Object.hasOwn(PROFILES, claimTypeCode)) return PROFILES[claimTypeCode];
  return claimDetailsOn() && Object.hasOwn(DEV_STAND_INS, claimTypeCode) ? DEV_STAND_INS[claimTypeCode] : GENERAL;
};

export default { GENERAL, PROFILES, profileOf };
