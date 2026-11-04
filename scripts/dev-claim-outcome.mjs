// Development only: reports a pretend outcome for a claim, as the claims web app would, so HR's screen shows
// the Amount & Status section with values before the claims web app sends any. It writes to the development
// store (CLAIM_DETAILS_DEV_STORE), never to the database.
//
//   npm run dev-claim-outcome -- <claim_id>           report one
//   npm run dev-claim-outcome -- <claim_id> --clear   take it away again
import { claimDetailsOn, getOutcome, saveOutcome } from "../src/claims/detailsStore.js";
import { checkOutcome } from "../src/claims/outcome.js";
import { update } from "../src/gcli/devStore.js";
import { localIsoDate } from "../src/utils/localDate.js";

const [claimId, ...flags] = process.argv.slice(2);

const stop = (message) => {
  console.error(message);
  process.exit(1);
};

if (!claimDetailsOn()) stop("CLAIM_DETAILS_DEV_STORE=true is needed (and not in production): this writes to the development store.");
if (!/^\d{1,18}$/.test(claimId ?? "")) stop("Usage: npm run dev-claim-outcome -- <claim_id> [--clear]");
if (flags.some((flag) => flag !== "--clear")) stop(`Unknown option ${flags.find((flag) => flag !== "--clear")}.`);

if (flags.includes("--clear")) {
  update((draft) => {
    delete draft.claimOutcomes?.[claimId];
  });
  console.log(`Claim ${claimId}: the pretend outcome is gone.`);
} else {
  const { value, errors } = checkOutcome({
    status: "For Payment",
    status_updated: localIsoDate(new Date()),
    total_claim_amount: 50000,
    burial_benefit_amount: 0,
    credit_claim_benefit_amount: 0,
    awaiting_reason: "A pretend outcome from npm run dev-claim-outcome, not the claims department's.",
  });
  if (value === null) stop(`The pretend outcome is not valid: ${Object.values(errors)[0]}`);

  saveOutcome(claimId, value);
  console.log(`Claim ${claimId}: reported`, getOutcome(claimId));
}
