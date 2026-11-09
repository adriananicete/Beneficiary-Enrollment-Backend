// The username the design gives an HR account: hr. and the company code in lower case, as hr.coforge and hr.hcl already
// are. A company can have several. The first is hr.<code>; the others are hr.<code>.2, hr.<code>.3 and so on, the first
// of those no account of the company has. A company code is letters, digits and hyphens (validateCompany), so it never
// holds a dot: a numbered name cannot be another company's hr.<code>. `taken` is the company's HR usernames.
export const hrUsernameFor = (companyCode, taken = []) => {
  const first = `hr.${companyCode.toLowerCase()}`;
  const used = new Set(taken.map((name) => String(name).toLowerCase()));

  let username = first;
  for (let number = 2; used.has(username); number++) username = `${first}.${number}`;

  return username;
};
