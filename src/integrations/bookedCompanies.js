import { AppError } from "../utils/AppError.js";
import { fetchBookedList } from "./ebamClient.js";

// The companies the other system has booked, as the Administrator's Companies tab shows them. Each record
// there is a policy: a company with two policies appears twice, with a policy number each, and BES holds
// one policy number per company, so a booked record is matched to a BES company by that number.
//
// Only what a screen uses is kept: what identifies the company and its policy, what the New company form starts
// with (a phone number, the age limit), the renewal date, and the contact person the HR account form starts with.
// The other system's record is much larger (rates, premiums, loans, files); none of that is passed on.

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

const same = (value) => String(value ?? "").trim().replace(/\s+/g, " ").toUpperCase();

const day = (value) => (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null);

const whole = (value) => (Number.isInteger(value) ? value : null);

// The person the other system names as the company's contact, for the HR account form to start with. Only the
// route that asks for one company passes it on. The record's own `email` is read when the person has none.
const contactOf = (application) => {
  const person = application.contact_person ?? {};
  const contact = {
    first_name: text(person.firstname),
    middle_name: text(person.mi),
    last_name: text(person.lastname),
    email: text(person.email) ?? text(application.email),
  };

  return Object.values(contact).some(Boolean) ? contact : null;
};

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
    expiry_date: day(application.expiry_date) ?? day(application.validity?.expiry_date),
    maximum_age: whole(application.maximum_age),
    phone: text(application.company_contact?.company_telephone) ?? text(application.company_contact?.company_mobile),
    contact: contactOf(application),
  };
};

const isNewer = (a, b) => {
  const [dayA, dayB] = [a.effective_date ?? "", b.effective_date ?? ""];

  return dayA > dayB || (dayA === dayB && Number(a.application_id) > Number(b.application_id));
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

  // A renewal keeps its policy number. Should the other system add a record for one, the company's record for
  // that number is the newest (by effective date, then by id) and not each of them. A record seen twice is one.
  const newest = new Map();
  for (const record of records) {
    const company = bookedCompanyOf(record);
    if (!company) continue;

    const key = company.policy_no ? `${same(company.policy_no)}|${same(company.company_name)}` : `id:${company.application_id}`;
    const held = newest.get(key);
    if (!held || isNewer(company, held)) newest.set(key, company);
  }

  return [...newest.values()].sort(
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
