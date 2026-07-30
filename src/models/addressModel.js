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

const updateClientAddress = async (pool, clientAddress) => {
  const result = await pool.request()
  .input('client_address_id', sql.BigInt, clientAddress.client_address_id)
  .input('barangay_id', sql.BigInt, clientAddress.barangay_id)
  .input('address_line', sql.NVarChar, clientAddress.address_line)
  .input('zip_code', sql.VarChar, clientAddress.zip_code)
  .input('modified_by', sql.VarChar, clientAddress.modified_by)
  .execute('usp_upd_client_address');
}

const getClientAddressId = async (pool, clientId) => {
  const result = await pool.request()
  .input('client_id', sql.BigInt, clientId)
  .query(`SELECT client_address_id FROM dbo.client_address WHERE client_id = @client_id`);

  return result.recordset[0];
}

export default {
    insertClientAddress,
    updateClientAddress,
    getClientAddressId
}