import ClientModel from "../models/clientModel.js";
import { AppError } from "../utils/AppError.js";
import { localIsoDate } from "../utils/localDate.js";
import { factsOf } from "./computed.js";
import { checkDetails } from "./detailsSchema.js";
import { claimDetailsOn, enqueueTransfer, saveDetails } from "./detailsStore.js";
import { GENERAL, profileOf } from "./profiles.js";

// What claimService does with the details of a claim, kept out of it so the filing code reads as it
// always did. Everything here does nothing while CLAIM_DETAILS_DEV_STORE is off.

// A 400 whose message is the first problem and whose `errors` names every field.
const refuseIfAny = (errors) => {
  if (Object.keys(errors).length > 0) throw new AppError(Object.values(errors)[0], 400, errors);
};

// Before the claim is written: checks what was sent and works out the facts to keep beside it.
// Returns null when there is nothing to keep (the switch is off, or the type takes no details),
// and throws the 400 otherwise. Reads the database only to look; nothing is written here.
//
// `clientId` is the insured's: the signed-in employee's own, or HR's chosen one, never a value from
// the request body. `enrollment` is the row the caller has already read for it, if it has.
// `filedOn` is the filing date ("YYYY-MM-DD"): today, or for a resubmit the day the claim was first
// filed. `recordedDeathDate` is the date of death already recorded for the employee, when HR files a
// death claim: the event date must be that one, so the age, the length of membership and the
// contestability are worked out from the date BES holds and not from one typed on the form.
export const prepareDetails = async (pool, { claimTypeCode, details, clientId, enrollment, filedOn, recordedDeathDate }) => {
  if (!claimDetailsOn()) return null;

  const profile = profileOf(claimTypeCode);

  if (profile === GENERAL) {
    refuseIfAny(checkDetails(profile, details).errors);
    return null;
  }

  const insured = enrollment ?? (await ClientModel.getEnrollmentByClientId(pool, clientId))[0];
  if (!insured) throw new AppError("Enrollment not found", 404);

  const { value, errors } = checkDetails(profile, details, { birthdate: insured.birthdate });
  refuseIfAny(errors);

  if (recordedDeathDate && value.event.date !== recordedDeathDate) {
    const message = `The date of death must be the one recorded for the employee, ${recordedDeathDate}.`;
    throw new AppError(message, 400, { "event.date": message });
  }

  const benefits = await ClientModel.getEnrollmentBenefitsByClientId(pool, clientId);

  return { details: value, ...factsOf({ details: value, enrollment: insured, benefits, filedOn: filedOn ?? localIsoDate(new Date()) }) };
};

// Both of the next two run after the database has committed, so a store that cannot be written (a
// locked or damaged file) must not turn a claim that was filed or approved into a 500, or stop what
// the caller still has to do. The failure is logged, as a failed email is.
const afterCommit = (what, claimId, write) => {
  try {
    write();
  } catch (error) {
    console.error(`${what} failed for claim ${claimId}:`, error);
  }
};

// After the claim is created: the claim's id exists only now.
export const keepDetails = (claimId, prepared) => {
  if (prepared) afterCommit("Keeping the claim details", claimId, () => saveDetails(claimId, prepared));
};

// After a claim is approved: it is queued for the claims web app, which reads it as the person who
// approved it (see detailsStore.enqueueTransfer).
export const queueTransfer = (claimId, { readerUserId, claimTypeCode }) => {
  if (claimDetailsOn())
    afterCommit("Queueing the claim for transfer", claimId, () => enqueueTransfer(claimId, { readerUserId, claimTypeCode }));
};

export default { prepareDetails, keepDetails, queueTransfer };
