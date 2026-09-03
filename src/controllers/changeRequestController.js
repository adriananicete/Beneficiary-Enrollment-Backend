import ChangeRequestModel from "../models/changeRequestModel.js";
import ClientModel from "../models/clientModel.js";
import BeneficiaryModel from "../models/beneficiaryModel.js";
import AddressModel from "../models/addressModel.js";
import { poolPromise } from "../config/db.js";
import { AppError } from "../utils/AppError.js";

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
