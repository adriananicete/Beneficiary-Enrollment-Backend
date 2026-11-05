import { getPool } from "../config/db.js";
import { bookedCompanies, markSetUp } from "../integrations/bookedCompanies.js";
import { ebamConfigured } from "../integrations/ebamClient.js";
import CompanyService from "../services/companyService.js";

// The companies the other system has booked, for the Administrator's Companies tab, each marked with the BES
// company it is when it has been set up. Without the other system's address and key in the environment
// there is no list, and the answer says so instead of failing. `?refresh=1` reads the list again instead
// of from the few minutes it is kept. Built from what it uses, so a test can replace them.
export const createGetBookedCompanies =
  ({
    poolOf = getPool,
    list = bookedCompanies,
    configured = ebamConfigured,
    companiesOf = (pool, userId) => CompanyService.getCompanies(pool, userId),
  } = {}) =>
  async (req, res, next) => {
    try {
      if (!configured()) return res.status(200).json({ success: true, data: { configured: false, fetched_at: null, companies: [] } });

      const listed = await list({ refresh: req.query.refresh === "1" });
      const companies = await companiesOf(await poolOf(), req.user.user_id);

      return res.status(200).json({
        success: true,
        data: { configured: true, fetched_at: new Date(listed.at).toISOString(), companies: markSetUp(listed.companies, companies) },
      });
    } catch (error) {
      next(error);
    }
  };

export const getBookedCompanies = createGetBookedCompanies();
