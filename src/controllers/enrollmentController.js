import { poolPromise } from "../config/db.js";
import ReferenceModel from "../models/referenceModel.js";
import EnrollmentService from "../services/enrollmentService.js";

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
      enrollmentId,
      policyNo,
      message: "Enrollment submitted successfully",
    });
  } catch (error) {
    next(error);
  }
};

export const getBarangays = async (req, res, next) => {
  try {
    const pool = await poolPromise;
    const barangays = await ReferenceModel.getBarangays(pool);
    return res.status(200).json({
      success: true,
      data: barangays
    })
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