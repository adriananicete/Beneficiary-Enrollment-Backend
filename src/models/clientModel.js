import { sql } from "../config/db.js";

const insertClient = async (pool, clientData) => {
  const result = await pool
    .request()
    .input("first_name", sql.VarChar, clientData.first_name)
    .input("middle_name", sql.VarChar, clientData.middle_name)
    .input("last_name", sql.VarChar, clientData.last_name)
    .input("suffix", sql.VarChar, clientData.suffix)
    .input("birthdate", sql.Date, clientData.birthdate)
    .input("birthplace", sql.VarChar, clientData.birthplace)
    .input("nationality", sql.VarChar, clientData.nationality)
    .input("tin_id", sql.VarChar, clientData.tin_id)
    .input("civil_status", sql.VarChar, clientData.civil_status)
    .input("gender", sql.Char, clientData.gender)
    .input("height", sql.Decimal, clientData.height)
    .input("weight", sql.Decimal, clientData.weight)
    .input("sss_gsis_no", sql.VarChar, clientData.sss_gsis_no)
    .input("contact_no", sql.VarChar, clientData.contact_no)
    .input("email_address", sql.VarChar, clientData.email_address)
    .input("occupation", sql.VarChar, clientData.occupation)
    .input("source_of_income", sql.VarChar, clientData.source_of_income)
    .input("signature_path", sql.NVarChar, clientData.signature_path)
    .input("created_by", sql.VarChar, clientData.created_by)
    .output("client_id", sql.BigInt)
    .execute("usp_ins_client");

  return result.output.client_id;
};

const updateClient = async (pool, clientData) => {
  await pool
    .request()
    .input("client_id", sql.BigInt, clientData.client_id)
    .input("first_name", sql.VarChar, clientData.first_name)
    .input("middle_name", sql.VarChar, clientData.middle_name)
    .input("last_name", sql.VarChar, clientData.last_name)
    .input("suffix", sql.VarChar, clientData.suffix)
    .input("birthdate", sql.Date, clientData.birthdate)
    .input("birthplace", sql.VarChar, clientData.birthplace)
    .input("nationality", sql.VarChar, clientData.nationality)
    .input("tin_id", sql.VarChar, clientData.tin_id)
    .input("civil_status", sql.VarChar, clientData.civil_status)
    .input("gender", sql.Char, clientData.gender)
    .input("height", sql.Decimal, clientData.height)
    .input("weight", sql.Decimal, clientData.weight)
    .input("sss_gsis_no", sql.VarChar, clientData.sss_gsis_no)
    .input("contact_no", sql.VarChar, clientData.contact_no)
    .input("email_address", sql.VarChar, clientData.email_address)
    .input("occupation", sql.VarChar, clientData.occupation)
    .input("source_of_income", sql.VarChar, clientData.source_of_income)
    .input("signature_path", sql.NVarChar, clientData.signature_path)
    .input("modified_by", sql.VarChar, clientData.modified_by)
    .execute("usp_upd_client");
};

const listClients = async (pool, filters) => {
  const result = await pool
    .request()
    .input("name", sql.VarChar, filters.name)
    .input("tin", sql.VarChar, filters.tin)
    .input("sss_gsis_no", sql.VarChar, filters.sss_gsis_no)
    .input("status", sql.Char, filters.status)
    .execute("usp_lst_client");

  return result.recordset;
};

export default {
  insertClient,
  updateClient,
  listClients,
};


