import { AppError } from "../utils/AppError.js";
import { fetchBookedList } from "./ebamClient.js";

// The companies the other system has booked, as the Administrator's Companies tab shows them. Each record
// there is a policy: a company with two policies appears twice, with a policy number each, and BES holds
// one policy number per company, so a booked record is matched to a BES company by that number.
//
// Only what identifies the company and its policy is kept. The other system's record is much larger
// (contact people, rates, files); none of that is passed on until a screen needs it.

// The other system pages by 100 whatever is asked for, so 100 is what is asked for.
const PAGE_SIZE = 100;
// A guard against a list that never ends, not a limit anyone should meet: 5,000 policies.
const MAX_PAGES = 50;
const TTL_MS = 5 * 60 * 1000;

// The kind of plan, from the front of the policy number ("G-TLI-14-052"). The templates are those of ref_plans.
const PLANS = {
  "G-TLI": "Group Term Life",
  "G-CLI": "Group Credit Life",
  "G-CBP": "Group Comprehensive Benefits",
  "G-ADD": "Group Accidental Death and Disability",
};

const text = (value) => {
  const trimmed = typeof value === "string" ? value.trim() : "";

  return trimmed === "" ? null : trimmed;
};

const day = (value) => (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null);

const templateOf = (policyNo) => /^(G-[A-Z]{2,4})(?:-|$)/.exec(policyNo ?? "")?.[1] ?? null;

// One record of the other system as the tab keeps it, or null when it names no company.
export const bookedCompanyOf = (application) => {
  const name = text(application?.group_name);
  if (!name || application.application_id === undefined || application.application_id === null) return null;

  const policyNo = text(application.policy_no) ?? text(application.policy_number);
  const template = templateOf(policyNo);

  return {
    application_id: String(application.application_id),
    company_name: name,
    policy_no: policyNo,
    plan_template: template,
    plan: template ? (PLANS[template] ?? null) : null,
    effective_date: day(application.effective_date),
    business_address: text(application.business_address),
    business_nature: text(application.business_nature?.name),
    number_of_lives: Number.isFinite(application.number_of_lives) ? application.number_of_lives : null,
  };
};

// Every page of the list, as the tab keeps it, by company name and then policy number. `fetchPage` is for tests.
export const loadBookedCompanies = async ({ fetchPage = fetchBookedList } = {}) => {
  const first = await fetchPage({ page: 1, limit: PAGE_SIZE });
  if (!Array.isArray(first?.data)) throw new AppError("The other system's answer is not in the form expected.", 502);

  const records = [...first.data];
  const last = Math.min(Number(first.pagination?.last_page) || 1, MAX_PAGES);

  for (let page = 2; page <= last; page++) {
    const next = await fetchPage({ page, limit: PAGE_SIZE });
    if (!Array.isArray(next?.data)) throw new AppError("The other system's answer is not in the form expected.", 502);

    records.push(...next.data);
  }

  const seen = new Set();
  const companies = [];
  for (const record of records) {
    const company = bookedCompanyOf(record);
    if (!company || seen.has(company.application_id)) continue;

    seen.add(company.application_id);
    companies.push(company);
  }

  return companies.sort(
    (a, b) => a.company_name.localeCompare(b.company_name, "en", { sensitivity: "base" }) || (a.policy_no ?? "").localeCompare(b.policy_no ?? ""),
  );
};

// The list is kept for a few minutes: it is read by one screen, and the other system is not ours to hammer.
// Only a list that was read is kept. `refresh` asks for a new one.
let kept = null;

export const bookedCompanies = async ({ refresh = false, now = Date.now, load = loadBookedCompanies } = {}) => {
  if (!refresh && kept && now() - kept.at < TTL_MS) return kept;

  const companies = await load();
  kept = { at: now(), companies };

  return kept;
};

export const forgetBookedCompanies = () => {
  kept = null;
};

const same = (value) => String(value ?? "").trim().replace(/\s+/g, " ").toUpperCase();

// Each booked record with the BES company it is, or null. By policy number when it has one: the same name
// with another policy is another policy. A record with no policy number is matched by name, and only when
// one BES company has that name.
export const markSetUp = (booked, companies) => {
  const byPolicy = new Map();
  const byName = new Map();

  for (const company of companies) {
    if (company.policy_no) byPolicy.set(same(company.policy_no), company);
    byName.set(same(company.company_name), [...(byName.get(same(company.company_name)) ?? []), company]);
  }

  return booked.map((entry) => {
    let found = entry.policy_no ? byPolicy.get(same(entry.policy_no)) : undefined;

    if (!found && !entry.policy_no) {
      const named = byName.get(same(entry.company_name));
      if (named?.length === 1) [found] = named;
    }

    // the BES company's own name goes with it, so a policy number that two systems give to different companies shows
    return { ...entry, set_up: found ? { employer_id: String(found.employer_id), company_code: found.company_code, company_name: found.company_name } : null };
  });
};

export default { bookedCompanyOf, loadBookedCompanies, bookedCompanies, forgetBookedCompanies, markSetUp };
