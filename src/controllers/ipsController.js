import { getPool } from "../config/db.js";
import ReferenceModel from "../models/referenceModel.js";

// What IPS reads (md/IPS-INTEGRATION-DECISIONS.md). Every company, inactive ones included with
// their status, so IPS can walk each company's enrollees. The group policy number is on every
// enrollee row (branch 2), so it is not repeated here.
export const ipsCompanyOf = (row) => ({
  employer_id: row.employer_id,
  company_code: row.company_code,
  company_name: row.company_name,
  status: row.status,
});

// Built from what it uses, so a test can replace them. `rows` goes on res.locals for the call
// log, which counts rows and never reads them.
export const createGetIpsCompanies =
  ({ poolOf = getPool, employersOf = (pool) => ReferenceModel.getEmployers(pool, { includeInactive: true }) } = {}) =>
  async (req, res, next) => {
    try {
      const rows = await employersOf(await poolOf());
      res.locals.ipsRows = rows.length;

      return res.status(200).json({
        success: true,
        data: { as_of: new Date().toISOString(), rows: rows.map(ipsCompanyOf) },
      });
    } catch (error) {
      next(error);
    }
  };

export const getIpsCompanies = createGetIpsCompanies();
