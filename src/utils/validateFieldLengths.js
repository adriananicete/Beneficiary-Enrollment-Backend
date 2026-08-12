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