import { getPool } from "../config/db.js";
import { bookedCompanies, markSetUp } from "../integrations/bookedCompanies.js";
import { ebamConfigured } from "../integrations/ebamClient.js";
import CompanyService from "../services/companyService.js";

// The companies the other system has booked, for the Administrator's Companies tab, each marked with the BES
// company it is when it has been set up. Without the other system's address and key in the environment
// there is no list, and the answer says so instead of failing. `?refresh=1` reads the list again instead
// of from the few minutes it is kept. `?employer_id=` answers only the records of that BES company, with the
// contact person the other system names (the HR account form starts with it); the list as a whole carries none.
// Built from what it uses, so a test can replace them.
const withoutContact = (entry) => {
  const copy = { ...entry };
  delete copy.contact;

  return copy;
};

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

      const marked = markSetUp(listed.companies, companies);
      const wanted = req.query.employer_id === undefined ? null : String(req.query.employer_id);

      return res.status(200).json({
        success: true,
        data: {
          configured: true,
          fetched_at: new Date(listed.at).toISOString(),
          companies: wanted === null ? marked.map(withoutContact) : marked.filter((entry) => entry.set_up?.employer_id === wanted),
        },
      });
    } catch (error) {
      next(error);
    }
  };

export const getBookedCompanies = createGetBookedCompanies();
