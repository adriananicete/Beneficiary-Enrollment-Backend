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
  // Note the narrowest thing in the chain is not this. sec.us01_usp_first_login
  // declares @us01_username varchar(20), so an id between 21 and 50 characters
  // enrols, signs in, is told to change its password, and cannot — the username
  // is truncated on the way into that procedure and matches nothing. The DBA has
  // been asked to widen it to 50 to match the column and the login procedure.
  // Until that lands, this cap stops the id growing past the column but not past
  // that procedure.
  employee_id_number: 50,
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