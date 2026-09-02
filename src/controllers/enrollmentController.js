import { poolPromise } from "../config/db.js";
import ReferenceModel from "../models/referenceModel.js";
import EnrollmentService from "../services/enrollmentService.js";
import InvitationModel from '../models/invitationModel.js';
import UserModel from "../models/userModel.js";
import { AppError } from "../utils/AppError.js";
import AgreementModel from "../models/agreementModel.js"

export const submitEnrollment = async (req, res, next) => {
  try {
    const { enrollmentId, policyNo } = await EnrollmentService.createEnrollment(
      {
        ...req.body,
        ip_address: req.ip,
        user_agent: req.headers["user-agent"]?.slice(0,500),
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

export const getEmployeeClassifications = async (req, res, next) => {
  try {
    const pool = await poolPromise;
    const employeeClassifications = await ReferenceModel.getEmployeeClassifications(pool);

    return res.status(200).json({
      success: true,
      data: employeeClassifications,
    })
  } catch (error) {
    next(error);
  }
};

export const getEmployers = async (req, res, next) => {
  try {
    const pool = await poolPromise;
    const employers = await ReferenceModel.getEmployers(pool);

    return res.status(200).json({
      success: true,
      data: employers
    })
  } catch (error) {
    next(error);
  }
};

export const getRegions = async (req, res, next) => {
  try {
    const pool = await poolPromise;
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

    const pool = await poolPromise;
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

    const pool = await poolPromise;
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

    const pool = await poolPromise;
    const barangaysByCity = await ReferenceModel.getBarangaysByCity(pool, city_code);

    return res.status(200).json({
      success: true,
      data: barangaysByCity
    });
  } catch (error) {
    next(error);
  }
};

export const getInvitationByToken = async (req, res, next) => {
  try {
    const { token } = req.query;
    if(!token) throw new AppError('Token is required', 400);
    const pool = await poolPromise;

    const invitation = await InvitationModel.getInvitationByToken(pool, token)
    if(!invitation) throw new AppError('Invitation not found', 404);
    if(invitation.is_valid === 0) throw new AppError('This invitation has expired. Please ask your HR to resend it.', 410);
    if(invitation.is_enrolled === 1) throw new AppError('You have already submitted an enrollment', 409);

    return res.status(200).json({
      success: true,
      data: invitation
    })
  } catch (error) {
    next(error);
  }
};

export const getMyAgreements = async (req, res, next) => {
  try {
    const { user_id } = req.user;
    const pool = await poolPromise;

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