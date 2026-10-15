import ReferenceModel from "../models/referenceModel.js";
import InvitationModel from "../models/invitationModel.js";
import EnrollmentService from "./enrollmentService.js";
import { AppError } from "../utils/AppError.js";

// Classifications belong to a company since DBA request 23. Both lists below
// are one company's classes and nothing else: the invitee's company on the
// public form, and HR's own company on HR's side.

// What a classification may show, named field by field rather than spread from
// the row, as publicEmployer and settingsOf do. No amounts: the procedure
// returns none today, and one added to it later must not reach the public form
// or HR by accident.
export const classificationOf = (row) => ({
  classification_id: row.classification_id,
  classification_code: row.classification_code,
  classification_desc: row.classification_desc,
});

// The public form's dropdown. The company comes from the invitation, so a link
// lists its own company's classes and no other, and a link the submit would
// refuse (not found, expired, already used) lists nothing.
const getForInvitation = async (pool, token) => {
  const invitation = await EnrollmentService.openInvitation(pool, token);

  const rows = await ReferenceModel.getClassificationsByEmployer(
    pool,
    invitation.employer_id,
  );

  return rows.map(classificationOf);
};

// HR's own company's classes. The company is the first the account is mapped
// to, the same one sendInvitations sends under (invitationService.js), so the
// list HR sees is the list their invitations will draw from. One HR account
// per company is the rule (decided 2026-10-06); an account mapped to two by
// hand would see the first only, as its invitations already do.
const getForUser = async (pool, userId) => {
  const employers = await InvitationModel.getEmployersByUser(pool, userId);
  if (employers.length === 0)
    throw new AppError("No company is assigned to your account", 403);

  const rows = await ReferenceModel.getClassificationsByEmployer(
    pool,
    employers[0].employer_id,
  );

  return rows.map(classificationOf);
};

export default {
  getForInvitation,
  getForUser,
};
