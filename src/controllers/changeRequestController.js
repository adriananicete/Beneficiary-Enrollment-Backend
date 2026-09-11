import ChangeRequestModel from "../models/changeRequestModel.js";
import ClientModel from "../models/clientModel.js";
import UserModel from "../models/userModel.js";
import BeneficiaryModel from "../models/beneficiaryModel.js";
import AddressModel from "../models/addressModel.js";
import ReferenceModel from "../models/referenceModel.js";
import { getPool } from "../config/db.js";
import { AppError } from "../utils/AppError.js";
import { sendChangeRequestDecisionEmail } from "../services/emailService.js";
import { certificateForDecision } from "../services/certificateService.js";
import { buildPage, parsePaging } from "../utils/parsePaging.js";
import {
  assertAddressBelongs,
  buildAddressChange,
  buildBeneficiaryChanges,
} from "../utils/changeRequestDiff.js";

export const submitChangeRequest = async (req, res, next) => {
  try {
    const { user_id } = req.user;

    const pool = await getPool();

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

      assertAddressBelongs(req.body.client_address_id, currentAddress);

      // Checked here as well as at enrollment, because approving writes this
      // straight to client_address and the reference joins then resolve to
      // nothing — silently, since full_address and zip_code are stored
      // separately and the address still displays. See PARK.md.
      //
      // Kept ahead of the change check on purpose: an invalid barangay is
      // refused whether or not the address turns out to have changed. Moving it
      // after would let a bad code through on a no-op edit.
      const barangayIsReal = await ReferenceModel.barangayExists(
        pool,
        req.body.barangay_id,
      );
      if (!barangayIsReal) throw new AppError("Invalid barangay", 400);

      const addressChange = buildAddressChange(req.body, currentAddress);

      if (addressChange) addressesJson = JSON.stringify([addressChange]);
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
    const paging = parsePaging(req.query);

    const pool = await getPool();

    const requests = await ChangeRequestModel.getChangeRequestsByUser(
      pool,
      req.user.user_id,
      status,
      paging,
    );

    return res.status(200).json({
      success: true,
      data: buildPage(requests, paging),
    });
  } catch (error) {
    next(error);
  }
};

// Drives the badge on the HR screen, polled every thirty seconds. One number.
export const getPendingChangeRequestCount = async (req, res, next) => {
  try {
    const pool = await getPool();

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

    const pool = await getPool();

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

    const pool = await getPool();

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

    await notifyDecision(pool, details, approved, reviewData.review_remarks);

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
//
// An approval carries a fresh Certificate of Coverage, built here because this
// runs after the approval has committed. It goes to the same pre-change
// address as the notice. A certificate that cannot be built costs the
// attachment, never the notice.
const notifyDecision = async (pool, details, approved, reviewRemarks) => {
  try {
    const to = currentEmailAddress(details);
    if (!to) {
      console.error("Change request decision email skipped: no address");
      return;
    }

    const certificate = await certificateForDecision(
      pool,
      details.request.client_id,
      approved,
    );

    await sendChangeRequestDecisionEmail({
      to,
      firstName: details.request.first_name,
      approved,
      reviewRemarks,
      attachments: certificate ? [certificate] : [],
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

    const pool = await getPool();

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

    const pool = await getPool();

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
