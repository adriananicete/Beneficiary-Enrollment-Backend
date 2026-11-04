// BES keeps a beneficiary's relationship as the text it was enrolled with ("Wife", "Son", "Aunt").
// The claim form asks for one of a short list (docs/claims-details/CONTRACT.md, "The details
// object"), so the text is read onto it. What is not recognised is "other beneficiary": the person is
// one, whatever they are called.
const BY_TEXT = {
  spouse: "SPOUSE",
  husband: "SPOUSE",
  wife: "SPOUSE",
  child: "CHILD",
  son: "CHILD",
  daughter: "CHILD",
  parent: "PARENT",
  father: "PARENT",
  mother: "PARENT",
  sibling: "SIBLING",
  brother: "SIBLING",
  sister: "SIBLING",
};

// Text only, and not a name every object has: hasOwn keeps "constructor" from answering.
export const relationshipOf = (text) => {
  const key = typeof text === "string" ? text.trim().toLowerCase() : "";

  return Object.hasOwn(BY_TEXT, key) ? BY_TEXT[key] : "OTHER_BENEFICIARY";
};

export default { relationshipOf };
