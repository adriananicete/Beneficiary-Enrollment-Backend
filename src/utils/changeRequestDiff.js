import { AppError } from "./AppError.js";

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
//
// Lifted out of changeRequestController on 2026-09-08. Nothing about the logic
// changed; it was module-private, so the most subtle code in the controller
// layer had no assertions and could not be given any.

// Values arrive from the form as strings and from the database as numbers, so
// they are compared as text after normalising. Null and empty string are treated
// as the same thing — a cleared optional field arrives as one and is stored as
// the other, and treating them as different would report a change on every
// submit.
export const same = (a, b) => String(a ?? "").trim() === String(b ?? "").trim();

export const buildBeneficiaryChanges = (submitted, current, enrollmentId) => {
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

// Ownership, and it is the address half of what `50106` enforces on the
// procedure side. The id arrives from the payload; the record it must match
// arrives from the database keyed by the caller's own client_id.
export const assertAddressBelongs = (submittedAddressId, currentAddress) => {
  if (
    !currentAddress ||
    String(currentAddress.client_address_id) !== String(submittedAddressId)
  )
    throw new AppError("Address does not belong to this enrollment", 403);
};

// Same reasoning as the beneficiaries: only produce a row if the address
// actually changed, so the review screen does not show an address change on
// every request.
//
// Note which fields are compared against which. The payload calls it
// `address_line` and the stored column is `full_address` — a rename between the
// two sides, and comparing the wrong pair would mark every address changed
// while looking entirely reasonable.
export const buildAddressChange = (submitted, currentAddress) => {
  const changed =
    !same(submitted.barangay_id, currentAddress.barangay_id) ||
    !same(submitted.address_line, currentAddress.full_address) ||
    !same(submitted.zip_code, currentAddress.zip_code);

  if (!changed) return null;

  return {
    clientAddressId: Number(submitted.client_address_id),
    action: "U",
    barangayId: submitted.barangay_id,
    addressLine: submitted.address_line,
    zipCode: submitted.zip_code,
  };
};

export default {
  same,
  buildBeneficiaryChanges,
  assertAddressBelongs,
  buildAddressChange,
};
