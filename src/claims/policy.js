import { localIsoDate } from "../utils/localDate.js";

// The policy a claim is judged on (docs/claims-details/CONTRACT.md, "The policy"). A group policy digest
// says what each benefit pays, what each loss is worth, who is covered until what age, and how long the
// claim takes. BES keeps the amounts of each benefit per classification (classification_benefits); the
// rest is here, as data, so a company's own terms are a row in POLICIES and not a change to a screen.
//
// Nothing here is shown to the person who filed the claim: it is what HR reads to review it.

// What a loss of the body is worth, as a percentage of the accidental death and dismemberment benefit
// (the digest's "Event of Loss"). The order is the digest's. Loss of life is a death claim, not a loss.
// "OTHER" is a loss the schedule does not name: it has no percentage and the claims department decides.
export const LOSS_EVENTS = [
  { code: "TWO_LIMBS", label: "Loss of two limbs", percent: 100 },
  { code: "BOTH_HANDS", label: "Loss of both hands, or all fingers and both thumbs", percent: 100 },
  { code: "BOTH_FEET", label: "Loss of both feet", percent: 100 },
  { code: "SIGHT_OF_BOTH_EYES", label: "Total loss of sight of both eyes", percent: 100 },
  { code: "BEDRIDDEN", label: "Injuries resulting in being permanently bedridden", percent: 100 },
  { code: "PERMANENT_TOTAL_DISABILITY", label: "Any other injury causing permanent total disability", percent: 100 },
  { code: "ARM_ABOVE_ELBOW", label: "Loss of arm at or above the elbow", percent: 70 },
  { code: "ARM_BELOW_ELBOW", label: "Loss of arm between the elbow and the wrist", percent: 60 },
  { code: "ONE_HAND", label: "Loss of a hand", percent: 50 },
  { code: "FOUR_FINGERS_AND_THUMB", label: "Loss of four fingers and the thumb of one hand", percent: 50 },
  { code: "FOUR_FINGERS", label: "Loss of four fingers", percent: 35 },
  { code: "THUMB", label: "Loss of the thumb", percent: 15 },
  { code: "INDEX_FINGER", label: "Loss of the index finger", percent: 10 },
  { code: "MIDDLE_FINGER", label: "Loss of the middle finger", percent: 6 },
  { code: "RING_FINGER", label: "Loss of the ring finger", percent: 5 },
  { code: "LITTLE_FINGER", label: "Loss of the little finger", percent: 4 },
  { code: "METACARPAL_1_2", label: "Loss of the 1st and 2nd metacarpals (additional)", percent: 3 },
  { code: "METACARPAL_3_5", label: "Loss of the 3rd, 4th or 5th metacarpal (additional)", percent: 2 },
  { code: "LEG_ABOVE_KNEE", label: "Loss of leg at or above the knee", percent: 60 },
  { code: "LEG_BELOW_KNEE", label: "Loss of leg below the knee", percent: 50 },
  { code: "ONE_FOOT", label: "Loss of one foot", percent: 50 },
  { code: "ALL_TOES_OF_ONE_FOOT", label: "Loss of all the toes of one foot", percent: 25 },
  { code: "BIG_TOE", label: "Loss of the big toe", percent: 5 },
  { code: "OTHER_TOE", label: "Loss of a toe other than the big toe (each)", percent: 1 },
  { code: "SIGHT_OF_ONE_EYE", label: "Loss of sight of one eye", percent: 50 },
  { code: "HEARING_BOTH_EARS", label: "Loss of hearing in both ears", percent: 50 },
  { code: "HEARING_ONE_EAR", label: "Loss of hearing in one ear", percent: 25 },
];

export const OTHER_LOSS = "OTHER";

// The codes a dismemberment claim may name, in the order the form lists them.
export const LOSS_CODES = [...LOSS_EVENTS.map((event) => event.code), OTHER_LOSS];

// The terms of a policy. STANDARD is what the digests read alike on; a company's own differences are
// below it. `period` is when the insurance runs (a claim for an event outside it is flagged), null when
// it is not known.
const STANDARD = {
  name: "Standard policy terms",
  loss_events: LOSS_EVENTS,
  incontestable_years: 1,
  notice_days: 30,
  proof_days: 90,
  basic_age_limit: 71,
  rider_age_limit: 66,
  terminal_illness: { percent_of_life: 50, max: null },
  burial: { amount: null },
  suicide_compensable: true,
  turnaround_business_days: { incontestable_death: 15, contestable_death: 30, disability: 15, terminal_illness: 15 },
  period: null,
};

// Keyed by the company's code (employers.company_code), in capitals.
const POLICIES = {
  FIRSTSOURCE: {
    ...STANDARD,
    name: "Firstsource Solution Ltd., Group Term Life 2026 policy digest",
    terminal_illness: { percent_of_life: 50, max: 4000000 },
    burial: { amount: 10000 },
    period: { from: "2026-10-01", to: "2027-09-30" },
  },
};

export const policyFor = (companyCode) =>
  (typeof companyCode === "string" && Object.hasOwn(POLICIES, companyCode.trim().toUpperCase()) && POLICIES[companyCode.trim().toUpperCase()]) || STANDARD;

// Which benefits of an employee's coverage are which. The coverage lists each by the code of its plan or
// rider (ref_plans, ref_riders).
const CODES = {
  life: ["GTLIP"],
  additional_life: ["ALCR"],
  tpd: ["GTPDR"],
  accidental: ["GADDR", "GADBR", "GADDRPR", "GSADDR", "GADDP", "GADDPP"],
  terminal_illness: ["GTIR"],
  burial: ["BMSR"],
};

const find = (coverage, codes) => (Array.isArray(coverage) ? coverage : []).find((benefit) => codes.includes(benefit.code));
const peso = (amount) => `PHP ${amount.toLocaleString("en-US")}`;
const percentIn = (formula) => {
  const match = /(\d+(?:\.\d+)?)\s*%/.exec(String(formula ?? ""));
  return match ? Number(match[1]) : null;
};
const cents = (amount) => Math.round(amount * 100) / 100;

const dayOf = (value) => (value instanceof Date ? localIsoDate(value) : typeof value === "string" ? value.slice(0, 10) : null);
const dayNumber = (iso) => {
  const [year, month, day] = iso.split("-").map(Number);
  return Date.UTC(year, month - 1, day) / 86400000;
};

// A line of the amount: what it is, what it comes to, and how that was worked out.
const line = (key, label, amount, basis) => ({ key, label, amount: amount === null ? null : cents(amount), basis });

// A benefit that pays its amount, or a percentage of it. Without the benefit, or with a formula and no
// amount, there is no figure and the line says why.
const benefitLine = (key, label, benefit, { percent = null, basisText = null, missing }) => {
  if (!benefit) return line(key, label, null, missing);
  if (benefit.amount === null || benefit.amount === undefined)
    return line(key, label, null, `Its amount is a formula (${benefit.formula ?? "not stated"}) and the amount itself is not stored.`);

  const amount = percent === null ? benefit.amount : (benefit.amount * percent) / 100;
  const basis = basisText ?? (percent === null ? peso(benefit.amount) : `${peso(benefit.amount)} × ${percent}%`);

  return line(key, label, amount, basis);
};

const business = (days) => `${days} business days from the complete documents`;

// What a claim comes to under the policy, and what HR should look at. `details` is the stored details of
// the claim, `coverage` and `computed` and `insured` what the server kept beside them, and `filedOn` the
// day the claim was filed. An estimate: the claims department's own figures replace it once reported.
export const assessClaim = ({ profile, details, coverage, computed, insured, filedOn }) => {
  const rules = policyFor(insured?.company_code);
  const age = computed?.age_at_event ?? null;
  const lines = [];
  const checks = [];

  const pastRiderLimit = age !== null && age > rules.rider_age_limit;
  const riderLimit = `The age at the event, ${age}, is past the age limit of ${rules.rider_age_limit} for riders, so this benefit does not apply.`;
  const lapsed = (built, key, label) => (pastRiderLimit ? line(key, label, null, riderLimit) : built);

  if (profile === "death") {
    lines.push(benefitLine("life", "Life benefit", find(coverage, CODES.life), { missing: "No life benefit is enrolled for this employee." }));

    const additional = find(coverage, CODES.additional_life);
    if (additional) lines.push(benefitLine("additional_life", "Additional life coverage", additional, { missing: "" }));

    if (details?.condition?.manner_of_death === "ACCIDENT") {
      const accidental = benefitLine("accidental", "Accidental death benefit", find(coverage, CODES.accidental), {
        missing: "The death was accidental, but no accidental death benefit is enrolled for this employee.",
      });
      lines.push(lapsed(accidental, "accidental", "Accidental death benefit"));
    }

    const burial = find(coverage, CODES.burial);
    if (burial && burial.amount !== null && burial.amount !== undefined) lines.push(benefitLine("burial", "Burial benefit", burial, { missing: "" }));
    else if (rules.burial.amount !== null) lines.push(line("burial", "Burial benefit", rules.burial.amount, `${peso(rules.burial.amount)}, due to any cause`));

    if (age !== null && age > rules.basic_age_limit)
      checks.push({ level: "warning", text: `The age at the event, ${age}, is past the age limit of ${rules.basic_age_limit} for the basic plan.` });
    if (details?.condition?.manner_of_death === "SUICIDE" && rules.suicide_compensable)
      checks.push({ level: "note", text: "The death was a suicide: it is compensable under this policy, whether the member was sane or insane." });
  }

  if (profile === "tpd") {
    lines.push(lapsed(benefitLine("tpd", "Total and permanent disability benefit", find(coverage, CODES.tpd), { missing: "No total and permanent disability benefit is enrolled for this employee." }), "tpd", "Total and permanent disability benefit"));
  }

  if (profile === "terminal_illness") {
    const life = find(coverage, CODES.life);
    const terminal = find(coverage, CODES.terminal_illness);
    let built;

    if (!terminal) built = line("terminal_illness", "Terminal illness benefit", null, "No terminal illness benefit is enrolled for this employee.");
    else if (terminal.amount !== null && terminal.amount !== undefined) built = line("terminal_illness", "Terminal illness benefit", terminal.amount, peso(terminal.amount));
    else if (!life || life.amount === null || life.amount === undefined)
      built = line("terminal_illness", "Terminal illness benefit", null, "It is a share of the life benefit, and the life benefit's amount is not stored.");
    else {
      const percent = percentIn(terminal.formula) ?? rules.terminal_illness.percent_of_life;
      const share = (life.amount * percent) / 100;
      const capped = rules.terminal_illness.max !== null && share > rules.terminal_illness.max;

      built = line(
        "terminal_illness",
        "Terminal illness benefit",
        capped ? rules.terminal_illness.max : share,
        `${percent}% of the life benefit ${peso(life.amount)}${capped ? `, capped at ${peso(rules.terminal_illness.max)}` : ""}`,
      );
    }
    lines.push(lapsed(built, "terminal_illness", "Terminal illness benefit"));
  }

  if (profile === "dismemberment") {
    const lossCode = details?.condition?.type_of_loss;
    const loss = rules.loss_events.find((event) => event.code === lossCode);
    const accidental = find(coverage, CODES.accidental);
    const label = "Accidental dismemberment benefit";
    const missing = "No accidental death and dismemberment benefit is enrolled for this employee.";
    let built;

    if (!loss) built = line("dismemberment", label, null, accidental ? "The loss is not one the schedule names: the claims department decides what it pays." : missing);
    else built = benefitLine("dismemberment", label, accidental, { percent: loss.percent, basisText: accidental && accidental.amount != null ? `${peso(accidental.amount)} × ${loss.percent}% (${loss.label.toLowerCase()})` : undefined, missing });

    lines.push(lapsed(built, "dismemberment", label));
  }

  if (pastRiderLimit && profile !== "death") checks.push({ level: "warning", text: riderLimit });

  // contestable or not, and how long the claim takes once the documents are complete
  const contestable = computed?.contestability === "CONTESTABLE";
  if (contestable)
    checks.push({ level: "warning", text: `Contestable: the event is within the policy's ${rules.incontestable_years} year incontestability period, so the insurer may look into the claim.` });
  else if (computed?.contestability === "INCONTESTABLE") checks.push({ level: "ok", text: `Incontestable: the event is past the policy's ${rules.incontestable_years} year incontestability period.` });
  if (computed?.event_before_coverage) checks.push({ level: "warning", text: "The event is before the coverage started." });

  // the notice and the proof of loss are due within set days of the event; a late one does not void the claim
  const eventDay = details?.event?.date ?? null;
  const filedDay = dayOf(filedOn);
  if (eventDay && filedDay) {
    const late = dayNumber(filedDay) - dayNumber(eventDay);

    if (late > rules.proof_days)
      checks.push({ level: "warning", text: `Filed ${late} days after the event. Proof of loss is due within ${rules.proof_days} days; a late one does not invalidate the claim if it was given as soon as reasonably possible.` });
    else if (late > rules.notice_days)
      checks.push({ level: "warning", text: `Filed ${late} days after the event. Notice of claim is due within ${rules.notice_days} days; a late notice does not invalidate the claim if it was given as soon as reasonably possible.` });
    else checks.push({ level: "ok", text: `Filed ${late} ${late === 1 ? "day" : "days"} after the event, within the ${rules.notice_days} days for notice of claim.` });
  }

  if (rules.period && eventDay && (eventDay < rules.period.from || eventDay > rules.period.to))
    checks.push({ level: "warning", text: `The event is outside the policy period, ${rules.period.from} to ${rules.period.to}.` });

  const days = rules.turnaround_business_days;
  const turnaround =
    profile === "death" ? (contestable ? days.contestable_death : days.incontestable_death) : profile === "terminal_illness" ? days.terminal_illness : days.disability;
  checks.push({ level: "note", text: `Processing takes ${business(turnaround)}.` });

  const known = lines.filter((entry) => entry.amount !== null);

  return {
    policy: rules.name,
    lines,
    total: known.length === 0 ? null : cents(known.reduce((sum, entry) => sum + entry.amount, 0)),
    complete: lines.length > 0 && known.length === lines.length,
    checks,
    turnaround_business_days: turnaround,
  };
};

export default { LOSS_EVENTS, LOSS_CODES, OTHER_LOSS, policyFor, assessClaim };
