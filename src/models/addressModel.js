import { sql } from "../config/db.js";

const insertClientAddress = async (pool, clientId, clientAddress) => {
  const result = await pool.request()
  .input('client_id', sql.BigInt, clientId)
  .input('barangay_id', sql.VarChar, clientAddress.barangay_id)
  .input('address_line', sql.NVarChar, clientAddress.address_line)
  .input('zip_code', sql.VarChar, clientAddress.zip_code)
  .input('created_by', sql.VarChar, clientAddress.created_by)
  .output('client_address_id', sql.BigInt)
  .execute('usp_ins_client_address');

  return result.output.client_address_id;
};

// Returns the whole active address row, not just the id. A change request has to
// compare the proposed address against the current one to know whether it
// actually changed, and barangay_id is not returned by usp_sel_insurance_enrollment
// — that procedure resolves it to brgy_name for display.
//
// The status = 'A' filter is new. Without it a soft-deleted row could be returned
// once address deletion exists; today nothing deletes one.
const getClientAddressId = async (pool, clientId) => {
  const result = await pool.request()
  .input('client_id', sql.BigInt, clientId)
  .query(`SELECT client_address_id, barangay_id, full_address, zip_code
          FROM dbo.client_address
          WHERE client_id = @client_id AND status = 'A'`);

  return result.recordset[0];
}

export default {
    insertClientAddress,
    getClientAddressId
}