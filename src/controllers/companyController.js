import { getPool } from "../config/db.js";
import CompanyService from "../services/companyService.js";

// The Administrator's companies, branch 2 of the onboarding effort. The routes
// allow the Administrator only, and the procedures check again.

export const getCompanies = async (req, res, next) => {
  try {
    const pool = await getPool();
    const companies = await CompanyService.getCompanies(pool, req.user.user_id);

    return res.status(200).json({
      success: true,
      data: companies,
    });
  } catch (error) {
    next(error);
  }
};

export const getCompany = async (req, res, next) => {
  try {
    const pool = await getPool();
    const company = await CompanyService.getCompany(pool, req.user.user_id, req.params.employer_id);

    return res.status(200).json({
      success: true,
      data: company,
    });
  } catch (error) {
    next(error);
  }
};

export const createCompany = async (req, res, next) => {
  try {
    const pool = await getPool();
    const company = await CompanyService.createCompany(pool, req.user.user_id, req.body);

    return res.status(201).json({
      success: true,
      message: "Company created",
      data: company,
    });
  } catch (error) {
    next(error);
  }
};

export const updateCompany = async (req, res, next) => {
  try {
    const pool = await getPool();
    const company = await CompanyService.updateCompany(
      pool,
      req.user.user_id,
      req.params.employer_id,
      req.body,
    );

    return res.status(200).json({
      success: true,
      message: "Company updated",
      data: company,
    });
  } catch (error) {
    next(error);
  }
};
