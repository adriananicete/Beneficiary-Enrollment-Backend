// What the audit trail records for a decision on a profile change request.
//
// bes.usp_upd_client_change_request_approve and _reject write no audit row of
// their own, and the approval overwrites the client's profile, so once it has
// run there is nothing left to compare with. The controller reads the request
// (current beside proposed) before it decides, and this turns that into the row:
// the module says what was decided, and the old and new values are what the Audit
// Trail's "Changes" table shows, side by side.
//
// A rejection changes nothing, so it records the decision and the reason only.
const OBJECT = "Profile change request";

const ACTION_WORDS = { I: "Added", U: "Updated", D: "Removed" };

const text = (value) => (value === null || value === undefined ? "" : String(value));

const withAction = (action, detail) => `${ACTION_WORDS[action] ?? "Changed"}: ${detail}`;

const addressText = ({ address_line, zip_code, client_address_id }) =>
  [address_line, zip_code].filter(Boolean).join(", ") || `address ${text(client_address_id)}`;

const beneficiaryText = ({ full_name, relationship, age, coverage_percent }) =>
  [
    full_name,
    relationship,
    age === null || age === undefined ? "" : `age ${age}`,
    coverage_percent === null || coverage_percent === undefined ? "" : `${coverage_percent}%`,
  ]
    .filter(Boolean)
    .join(", ");

// `details` is what ChangeRequestModel.getChangeRequestById returned before the decision.
export const changeRequestAuditEntry = (details, { approved, reviewRemarks }) => {
  const { changedFields = [], addresses = [], beneficiaries = [] } = details ?? {};

  const oldValues = { Status: "PENDING" };
  const newValues = { Status: approved ? "APPROVED" : "REJECTED" };
  if (reviewRemarks) newValues["Review remarks"] = reviewRemarks;

  if (approved) {
    for (const field of changedFields) {
      oldValues[field.field_name] = text(field.current_value);
      newValues[field.field_name] = text(field.proposed_value);
    }

    // What these were before is not in the request, so only the new side is recorded.
    addresses.forEach((address, index) => {
      newValues[`Address ${index + 1}`] = withAction(address.change_action, addressText(address));
    });
    beneficiaries.forEach((beneficiary, index) => {
      newValues[`Beneficiary ${index + 1}`] = withAction(beneficiary.change_action, beneficiaryText(beneficiary));
    });
  }

  return {
    object: `${OBJECT} (${approved ? "approved" : "rejected"})`,
    oldValues,
    newValues,
  };
};

export default { changeRequestAuditEntry };
