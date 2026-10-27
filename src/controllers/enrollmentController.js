import { getPool } from "../config/db.js";
import ReferenceModel from "../models/referenceModel.js";
import EnrollmentService from "../services/enrollmentService.js";
import ClassificationService from "../services/classificationService.js";
import InvitationModel from '../models/invitationModel.js';
import UserModel from "../models/userModel.js";
import { AppError } from "../utils/AppError.js";
import { isInvitationToken } from "../middlewares/validateIdParam.js";
import AgreementModel from "../models/agreementModel.js"
import SignatureModel from "../models/signatureModel.js";
import { sendSignature } from "../utils/signatureResponse.js";
import { invitationExtras } from "../gcli/creditSubmission.js";

export const submitEnrollment = async (req, res, next) => {
  try {
    const pool = await getPool();

    // The raw base64 is dropped here and the decoded form takes its name. It
    // has no business travelling any further as a string: the last time an
    // image did that it reached an NVarChar(500) and was cut to fit.
    const { signature, ...body } = req.body;

    const { enrollmentId, policyNo } = await EnrollmentService.createEnrollment(
      pool,
      {
        ...body,
        ip_address: req.ip,
        user_agent: req.headers["user-agent"]?.slice(0,500),
        signature: req.signature ?? null,
      },
    );

    return res.status(201).json({
      success: true,
      data: { enrollmentId, policyNo },
      message: "Enrollment submitted successfully",
    });
  } catch (error) {
    next(error);
  }
};

// The invitation's company's classes, and no other company's. Needs the token
// since DBA request 23: before it, every company's classes were one list and
// this answered anybody. The token is checked the way GET /invitation checks
// it, and before the database for the same reason.
export const getEmployeeClassifications = async (req, res, next) => {
  try {
    const { token } = req.query;
    if(!token) throw new AppError('Token is required', 400);
    if(!isInvitationToken(token)) throw new AppError('Invitation not found', 404);

    const pool = await getPool();
    const classifications = await ClassificationService.getForInvitation(pool, token);

    return res.status(200).json({
      success: true,
      data: classifications,
    })
  } catch (error) {
    next(error);
  }
};

// What the public employer list may show, named field by field. This route
// needs no account. It used to return the procedure's rows as they came, so a
// column added to usp_sel_employers would have gone straight to anybody who
// asked. dbo.employers gained send_coc_email on 2026-10-06 (DBA request 19).
// The procedure names its columns, so it did not leak, but that was the
// procedure's choice and not this route's. The four fields are the ones it
// returns today, so the response is unchanged.
export const publicEmployer = (row) => ({
  employer_id: row.employer_id,
  company_code: row.company_code,
  company_name: row.company_name,
  status: row.status,
});

export const getEmployers = async (req, res, next) => {
  try {
    const pool = await getPool();
    const employers = await ReferenceModel.getEmployers(pool);

    return res.status(200).json({
      success: true,
      data: employers.map(publicEmployer)
    })
  } catch (error) {
    next(error);
  }
};

export const getRegions = async (req, res, next) => {
  try {
    const pool = await getPool();
    const regions = await ReferenceModel.getRegions(pool);

    return res.status(200).json({
      success: true,
      data: regions
    })
  } catch (error) {
    next(error)
  }
};

export const getProvincesByRegion = async (req, res, next) => {
  try {
    const { region_code } = req.params;

    const pool = await getPool();
    const provincesByRegion = await ReferenceModel.getProvincesByRegion(pool, region_code);

    return res.status(200).json({
      success: true,
      data: provincesByRegion
    });

  } catch (error) {
    next(error);
  }
};

export const getCitiesByProvince = async (req, res, next) => {
  try {
    const { province_code } = req.params;

    const pool = await getPool();
    const citiesByProvince = await ReferenceModel.getCitiesByProvince(pool, province_code);

    return res.status(200).json({
      success: true,
      data: citiesByProvince
    });

  } catch (error) {
    next(error);
  }
};

export const getBarangaysByCity = async (req, res, next) => {
  try {
    const { city_code } = req.params;

    const pool = await getPool();
    const barangaysByCity = await ReferenceModel.getBarangaysByCity(pool, city_code);

    return res.status(200).json({
      success: true,
      data: barangaysByCity
    });
  } catch (error) {
    next(error);
  }
};

// What the public invitation lookup may show, named field by field, as
// publicEmployer does above. The route needs no account: anybody holding a
// link gets this answer. It used to send the procedure's row as it came, so a
// column added to usp_sel_enrollment_invitation_by_token went straight out.
// Requests 23 and 25 add some (the class, the company's age limit, the
// affiliate), and none of them leaves unless it is named here.
//
// The ten fields are the ones the procedure returned on 2026-10-14 and
// FRONTEND-API.md documents. Branch 6 of the onboarding effort adds the class
// and the affiliate HR assigned, each an object or null, for the form to show
// read-only. The company's age limit still stays out.
export const publicInvitation = (row) => ({
  invitation_id: row.invitation_id,
  employer_id: row.employer_id,
  company_code: row.company_code,
  company_name: row.company_name,
  email_address: row.email_address,
  sent_date: row.sent_date,
  expiry_date: row.expiry_date,
  is_valid: row.is_valid,
  is_enrolled: row.is_enrolled,
  client_id: row.client_id,
  // null for an invitation sent before branch 6: the form then shows the
  // class dropdown, as before.
  classification:
    row.classification_id == null
      ? null
      : {
          classification_id: row.classification_id,
          classification_code: row.classification_code,
          classification_desc: row.classification_desc,
        },
  // null when the employee is the company's own, not an affiliate's.
  affiliate:
    row.affiliate_id == null
      ? null
      : {
          affiliate_id: row.affiliate_id,
          affiliate_code: row.affiliate_code,
          affiliate_name: row.affiliate_name,
        },
});

export const getInvitationByToken = async (req, res, next) => {
  try {
    const { token } = req.query;
    if(!token) throw new AppError('Token is required', 400);

    // Checked before the token reaches NVarChar(64) in the model. Without this
    // a string longer than 64 characters is refused by the driver, and that
    // error is neither an AppError nor a mapped SQL number — so this public
    // endpoint answers 500 and writes a stack trace, for anyone, with no
    // account. The same rule already guards the submit path.
    //
    // 404, the same answer a token that does not exist gets. A caller trying
    // tokens learns nothing from the difference.
    if(!isInvitationToken(token)) throw new AppError('Invitation not found', 404);

    const pool = await getPool();

    const invitation = await InvitationModel.getInvitationByToken(pool, token)
    if(!invitation) throw new AppError('Invitation not found', 404);
    // Truthiness rather than === 0 and === 1, for the reason set out at the
    // same two checks in enrollmentService.js: the two invitation procedures
    // return these computed columns as different types, and a strict
    // comparison is silently false against one of them.
    if(!invitation.is_valid) throw new AppError('This invitation has expired. Please ask your HR to resend it.', 410);
    if(invitation.is_enrolled) throw new AppError('You have already submitted an enrollment', 409);

    return res.status(200).json({
      success: true,
      // The company's plan and loan limits, while the dev store is on (src/gcli).
      data: { ...publicInvitation(invitation), ...invitationExtras(invitation, token) }
    })
  } catch (error) {
    next(error);
  }
};

// The employee's own signature. Same shape as getMyAgreements below: the
// client_id comes from their own user row rather than from anything they sent,
// so there is no id to scope and nothing to check beyond who they are.
export const getMySignature = async (req, res, next) => {
  try {
    const { user_id } = req.user;
    const pool = await getPool();

    const user = await UserModel.findUserById(pool, user_id);
    if (!user?.client_id)
      throw new AppError("No enrollment found for this account", 404);

    const signature = await SignatureModel.getSignatureByClient(pool, user.client_id);
    if (!signature)
      throw new AppError("No signature on file for this enrollment", 404);

    return sendSignature(res, signature);
  } catch (error) {
    next(error);
  }
};

export const getMyAgreements = async (req, res, next) => {
  try {
    const { user_id } = req.user;
    const pool = await getPool();

    const user = await UserModel.findUserById(pool, user_id);
    if(!user?.client_id) throw new AppError('No enrollment found for this account', 404);

    const agreements = await AgreementModel.getClientAgreements(pool, user.client_id);

    return res.status(200).json({
      success: true,
      data: agreements
    });
  } catch (error) {
    next(error);
  }
}