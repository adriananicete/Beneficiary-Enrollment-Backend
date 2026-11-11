import { sql } from "../config/db.js";

// IPS reads one company's active enrollees a page at a time (DBA request 33,
// md/IPS-INTEGRATION-DECISIONS.md). One call per page, where the teammates'
// version made three per enrollee.
//
// bes.usp_sel_ips_enrollees has no user parameter: it answers a company's
// personal data to whoever can execute it. Only the IPS route calls this, behind
// the key (src/middlewares/ipsAccess.js). It THROWs 50187 for an unknown company.
//
// Four result sets: the people, one row each, in client_id order after
// `afterClientId`; their benefits; their beneficiaries; and has_more.
const getEnrollees = async (pool, { employerId, afterClientId = null, limit }) => {
  const result = await pool
    .request()
    .input("employer_id", sql.BigInt, employerId)
    .input("after_client_id", sql.BigInt, afterClientId)
    .input("limit", sql.Int, limit)
    .execute("bes.usp_sel_ips_enrollees");

  const [people = [], benefits = [], beneficiaries = [], more = []] = result.recordsets ?? [];

  return { people, benefits, beneficiaries, hasMore: Boolean(more[0]?.has_more) };
};

export default { getEnrollees };
