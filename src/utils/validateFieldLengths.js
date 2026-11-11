export const BENEFICIARY_FIELD_LENGTHS = {
  full_name: 255,
  relationship: 50,
};

export const ADDRESS_FIELD_LENGTHS = {
  address_line: 255,
  barangay_id: 9,
  zip_code: 4,
};

export const CLIENT_FIELD_LENGTHS = {
  // Matches sec.us01_users.us01_username, which this becomes. It had no cap at
  // all, and the live data shows what that allows: a thirty-character employee
  // id sitting in the table as somebody's login.
  //
  // sec.us01_usp_first_login once declared @us01_username varchar(20), so an id
  // of 21 to 50 characters enrolled and then could not change its password. It
  // is varchar(50) now, like the login procedures (read in SP.sql, UAT,
  // 2026-11-11), so 50 holds the whole way. HR's Employee ID on the invitation
  // has the same cap (partitionInvitations, DBA request 32).
  employee_id_number: 50,
  // Stored in bes.client_employers, not bes.clients, and here because this map
  // is the personal payload rather than one table. It had no cap until
  // 2026-09-23, so a title past the column reached SQL Server, whose truncation
  // error is unmapped and answered 500. 150 is the column width, read from
  // INFORMATION_SCHEMA that day. Only the submit path sends it.
  position_title: 150,
  first_name: 100,
  middle_name: 100,
  last_name: 100,
  suffix: 5,
  birthplace: 100,
  nationality: 100,
  tin_id: 20,
  civil_status: 20,
  gender: 1,
  sss_gsis_no: 30,
  contact_no: 30,
  email_address: 150,
  occupation: 150,
  source_of_income: 150,
  signature_path: 500,
};

export const validateFieldLengths = (data, fieldLengths) => {
    for (let [field, max] of Object.entries(fieldLengths)) {
        const value = data[field];
        if(typeof value !== 'string') continue;
        if(value.length > max)
            return `${field} must not exceed ${max} characters`;
    }
    return null;
}