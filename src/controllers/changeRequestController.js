import ChangeRequestModel from "../models/changeRequestModel.js";
import ClientModel from "../models/clientModel.js";
import UserModel from "../models/userModel.js";
import BeneficiaryModel from "../models/beneficiaryModel.js";
import AddressModel from "../models/addressModel.js";
import { poolPromise } from "../config/db.js";
import { AppError } from "../utils/AppError.js";
import { sendChangeRequestDecisionEmail } from "../services/emailService.js";

// The employee submits the full intended state, exactly as the removed
// PUT /api/employee/enrollment did: a beneficiary carrying an id is an edit, one
// without is new, and one left out is a removal. Keeping that contract means the
// frontend changes a URL and nothing else, and validateEnrollmentUpdate keeps
// working unchanged.
//
// The stored procedure wants the changes as actions, so the translation happens
// here. Its OPENJSON keys are camelCase — the only camelCase in this API — and a
// key it does not recognise reads as NULL rather than erroring, so a typo would
// surface as a row of nulls at approval time rather than as a failure here.
// Values arrive from the form as strings and from the database as numbers, so
// they are compared as text after normalising. Null and empty string are treated
// as the same thing — a cleared optional field arrives as one and is stored as
// the other, and treating them as different would report a change on every
// submit.
const same = (a, b) => String(a ?? "").trim() === String(b ?? "").trim();

const buildBeneficiaryChanges = (submitted, current, enrollmentId) => {
  const currentIds = new Set(current.map((b) => String(b.beneficiary_id)));
  const currentById = new Map(
    current.map((b) => [String(b.beneficiary_id), b]),
  );

  const toUpdate = submitted.filter((b) => b.beneficiary_id);
  const toInsert = submitted.filter((b) => !b.beneficiary_id);

  for (const beneficiary of toUpdate) {
    if (!currentIds.has(String(beneficiary.beneficiary_id)))
      throw new AppError("Beneficiary does not belong to this enrollment", 403);
  }

  const submittedIds = new Set(toUpdate.map((b) => String(b.beneficiary_id)));
  if (submittedIds.size !== toUpdate.length)
    throw new AppError(
      "Duplicate beneficiary is not allowed in the same request.",
      400,
    );

  const toDelete = [...currentIds].filter((id) => !submittedIds.has(id));

  // Only genuinely edited beneficiaries become U rows. Sending one for every
  // existing beneficiary would work, but the review screen lists these rows as
  // they are — so HR would see every beneficiary marked as changed when the
  // employee corrected one name, and the whole point of the screen is knowing
  // what actually changed.
  const changed = toUpdate.filter((b) => {
    const existing = currentById.get(String(b.beneficiary_id));
    return (
      !same(b.full_name, existing.full_name) ||
      !same(b.relationship, existing.relationship) ||
      !same(b.age, existing.age) ||
      !same(b.coverage_percent, existing.coverage_percent)
    );
  });

  const row = (action, beneficiary, beneficiaryId = null) => ({
    beneficiaryId,
    enrollmentId: Number(enrollmentId),
    action,
    fullName: beneficiary?.full_name ?? null,
    relationship: beneficiary?.relationship ?? null,
    age: beneficiary?.age ?? null,
    coveragePercent: beneficiary?.coverage_percent ?? null,
  });

  return [
    ...toDelete.map((id) => row("D", null, Number(id))),
    ...changed.map((b) => row("U", b, Number(b.beneficiary_id))),
    ...toInsert.map((b) => row("I", b)),
  ];
};

export const submitChangeRequest = async (req, res, next) => {
  try {
    const { user_id } = req.user;

    const pool = await poolPromise;

    const enrollment = await ClientModel.getMyEnrollment(pool, user_id);
    if (!enrollment || enrollment.length === 0)
      throw new AppError("Enrollment not found", 404);

    const { client_id, enrollment_id, signature_path } = enrollment[0];

    let addressesJson = null;
    if (req.body.client_address_id) {
      const currentAddress = await AddressModel.getClientAddressId(
        pool,
        client_id,
      );

      if (
        !currentAddress ||
        String(currentAddress.client_address_id) !==
          String(req.body.client_address_id)
      )
        throw new AppError("Address does not belong to this enrollment", 403);

      // Same reasoning as the beneficiaries: only send a row if the address
      // actually changed, so the review screen does not show an address change
      // on every request.
      const addressChanged =
        !same(req.body.barangay_id, currentAddress.barangay_id) ||
        !same(req.body.address_line, currentAddress.full_address) ||
        !same(req.body.zip_code, currentAddress.zip_code);

      if (addressChanged)
        addressesJson = JSON.stringify([
          {
            clientAddressId: Number(req.body.client_address_id),
            action: "U",
            barangayId: req.body.barangay_id,
            addressLine: req.body.address_line,
            zipCode: req.body.zip_code,
          },
        ]);
    }

    let beneficiariesJson = null;
    if (req.body.beneficiaries !== undefined) {
      const currentBeneficiaries =
        await BeneficiaryModel.getBeneficiariesByEnrollmentId(
          pool,
          enrollment_id,
        );

      const changes = buildBeneficiaryChanges(
        req.body.beneficiaries,
        currentBeneficiaries,
        enrollment_id,
      );

      // No change to the list at all means no rows to send. An empty document
      // would still create the request; null keeps the procedure from touching
      // the beneficiary table.
      beneficiariesJson = changes.length ? JSON.stringify(changes) : null;
    }

    const requestId = await ChangeRequestModel.insertChangeRequest(pool, {
      ...req.body,
      client_id,
      // Taken from the stored record, never from the payload. Nothing populates
      // this field yet, and the approval writes every client column straight
      // through — so passing whatever the form sent would clear a real value the
      // day file upload is built.
      signature_path,
      addresses_json: addressesJson,
      beneficiaries_json: beneficiariesJson,
      submitted_by: String(user_id),
    });

    return res.status(201).json({
      success: true,
      data: { changeRequestId: requestId },
      message: "Change request submitted successfully",
    });
  } catch (error) {
    next(error);
  }
};

const REVIEW_DECISIONS = ["APPROVED", "REJECTED"];

// HR's list. The procedure handles company scoping and lets an Administrator
// through unscoped, so nothing here filters.
export const getChangeRequests = async (req, res, next) => {
  try {
    const { status } = req.query;

    const pool = await poolPromise;

    const requests = await ChangeRequestModel.getChangeRequestsByUser(
      pool,
      req.user.user_id,
      status,
    );

    return res.status(200).json({
      success: true,
      data: requests,
    });
  } catch (error) {
    next(error);
  }
};

// Drives the badge on the HR screen, polled every thirty seconds. One number.
export const getPendingChangeRequestCount = async (req, res, next) => {
  try {
    const pool = await poolPromise;

    const pendingCount = await ChangeRequestModel.getPendingCountByUser(
      pool,
      req.user.user_id,
    );

    return res.status(200).json({
      success: true,
      data: { pendingCount },
    });
  } catch (error) {
    next(error);
  }
};

export const getChangeRequestDetails = async (req, res, next) => {
  try {
    const { request_id } = req.params;

    const pool = await poolPromise;

    const details = await ChangeRequestModel.getChangeRequestById(
      pool,
      request_id,
      req.user.user_id,
    );

    // The procedure returns nothing at all for another company's request rather
    // than throwing, so an empty header is how "not yours" arrives. It is
    // answered the same way as a request that does not exist — telling the two
    // apart would confirm the other company's row is there.
    if (!details.request)
      throw new AppError("Change request not found", 404);

    return res.status(200).json({
      success: true,
      data: details,
    });
  } catch (error) {
    next(error);
  }
};

// Approve or reject. The approve procedure applies the change and marks the
// request in one transaction it owns, so nothing is applied here — a failure
// part way through leaves the request PENDING and the record untouched.
export const reviewChangeRequest = async (req, res, next) => {
  try {
    const { request_id } = req.params;
    const { status, review_remarks } = req.body;

    if (!REVIEW_DECISIONS.includes(status))
      throw new AppError("Status must be APPROVED or REJECTED", 400);

    // Required on a rejection because it is the only thing that tells the
    // employee what to fix. A rejection with no reason produces a resubmission
    // of the same thing.
    if (status === "REJECTED" && !review_remarks?.trim())
      throw new AppError("Review remarks are required when rejecting", 400);

    const pool = await poolPromise;

    // Read the request before deciding on it. This settles company scoping
    // before any procedure runs, and it is the only chance to capture the
    // employee's current email address — an approved change can move it.
    const details = await ChangeRequestModel.getChangeRequestById(
      pool,
      request_id,
      req.user.user_id,
    );

    if (!details.request)
      throw new AppError("Change request not found", 404);

    const approved = status === "APPROVED";

    const reviewData = {
      client_change_request_id: request_id,
      reviewed_by: String(req.user.user_id),
      review_remarks: review_remarks?.trim() || null,
    };

    if (approved)
      await ChangeRequestModel.approveChangeRequest(pool, reviewData);
    else await ChangeRequestModel.rejectChangeRequest(pool, reviewData);

    if (approved) await syncUserRecord(pool, details, reviewData.reviewed_by);

    await notifyDecision(details, approved, reviewData.review_remarks);

    return res.status(200).json({
      success: true,
      message: approved
        ? "Change request approved and applied"
        : "Change request rejected",
    });
  } catch (error) {
    next(error);
  }
};

// Fields that exist on both dbo.clients and sec.us01_users, by the display names
// the comparison result set uses.
const SYNCED_FIELDS = [
  "First Name",
  "Middle Name",
  "Last Name",
  "Email Address",
];

// dbo.clients and sec.us01_users hold the same name and email twice. The approve
// procedure writes the first and does not touch the second, so without this they
// drift apart on every approved name or email change.
//
// It matters most for the email. Nothing reads us01_email_address yet, but the
// credentials resend will send a new password there — an employee could correct
// their address, have it approved, and still have credentials go to the old
// inbox, with no error anywhere.
//
// Runs after the approve procedure has committed, because that procedure owns
// and closes its own transaction. A failure here therefore leaves exactly the
// divergence this exists to prevent — so it is logged with everything needed to
// repair it by hand, rather than swallowed quietly the way the email is. A
// failed email is a person not told; this is data that disagrees with itself.
const syncUserRecord = async (pool, { request, changedFields }, modifiedBy) => {
  try {
    const touchesUserRecord = changedFields.some((field) =>
      SYNCED_FIELDS.includes(field.field_name),
    );
    if (!touchesUserRecord) return;

    const user = await UserModel.findUserByClientId(pool, request.client_id);
    const userId = user?.us01_user_id;
    if (!userId) {
      console.error(
        `User record sync skipped: no active user for client ${request.client_id}`,
      );
      return;
    }

    // The proposed values, which are the client's values now that the change is
    // applied. Note this is the NEW email, unlike the decision notice, which
    // deliberately goes to the old one — the notice goes where we know they
    // read, the record has to hold what is now true.
    await UserModel.updateUserRecord(pool, {
      us01_user_id: userId,
      us01_first_name: request.first_name,
      us01_middle_name: request.middle_name,
      us01_last_name: request.last_name,
      us01_email_address: request.email_address,
      us01_modified_by: modifiedBy,
    });
  } catch (error) {
    console.error(
      `User record sync FAILED for client ${request.client_id}. ` +
        `sec.us01_users still holds the old name or email and must be corrected by hand. ` +
        `Intended: ${request.first_name} ${request.middle_name ?? ""} ${request.last_name} <${request.email_address}>`,
      error,
    );
  }
};

// Sent after the decision has committed, and it swallows its own failures. The
// same rule as recordSendStatus in invitationService: HR decided, and the record
// must reflect that whether or not Microsoft was reachable. A failed email is a
// person not told; a failed decision is a record that disagrees with what HR did.
const notifyDecision = async (details, approved, reviewRemarks) => {
  try {
    const to = currentEmailAddress(details);
    if (!to) {
      console.error("Change request decision email skipped: no address");
      return;
    }

    await sendChangeRequestDecisionEmail({
      to,
      firstName: details.request.first_name,
      approved,
      reviewRemarks,
    });
  } catch (error) {
    console.error("Change request decision email failed:", error);
  }
};

// Deliberately the address the employee had BEFORE the decision, not after.
//
// A request can propose a new email address. If it is approved, that address
// becomes their address of record — and their login. Sending the notice there
// means a typo in the new address leaves them never learning that their own
// email moved, on the one message that would have told them.
//
// The old address is the one that has demonstrably reached them before. The
// comparison result set carries the current value whenever the field changed;
// when it did not change, the proposed value is the current one.
const currentEmailAddress = ({ request, changedFields }) => {
  const emailChange = changedFields.find(
    (field) => field.field_name === "Email Address",
  );

  return emailChange?.current_value || request.email_address;
};

export const getMyChangeRequests = async (req, res, next) => {
  try {
    const { user_id } = req.user;

    const pool = await poolPromise;

    const enrollment = await ClientModel.getMyEnrollment(pool, user_id);
    if (!enrollment || enrollment.length === 0)
      throw new AppError("Enrollment not found", 404);

    const requests = await ChangeRequestModel.getChangeRequestsByClient(
      pool,
      enrollment[0].client_id,
    );

    return res.status(200).json({
      success: true,
      data: requests,
    });
  } catch (error) {
    next(error);
  }
};

export const cancelMyChangeRequest = async (req, res, next) => {
  try {
    const { user_id } = req.user;
    const { request_id } = req.params;

    const pool = await poolPromise;

    const enrollment = await ClientModel.getMyEnrollment(pool, user_id);
    if (!enrollment || enrollment.length === 0)
      throw new AppError("Enrollment not found", 404);

    // The client id comes from the session, never the request. The procedure
    // refuses anything that is not this client's, and answers the same way it
    // does for a request that is no longer pending.
    await ChangeRequestModel.cancelChangeRequest(pool, {
      client_change_request_id: request_id,
      client_id: enrollment[0].client_id,
      cancelled_by: String(user_id),
      cancel_remarks: req.body?.cancel_remarks ?? null,
    });

    return res.status(200).json({
      success: true,
      message: "Change request cancelled",
    });
  } catch (error) {
    next(error);
  }
};
