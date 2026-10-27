// Philippine zip codes are four digits, and the column is varchar(4). The
// length cap in validateFieldLengths already stopped a fifth character, but it
// could not stop four of the wrong kind — "abcd" and "11 0" both fit.
//
// varchar rather than a number is correct and should stay: a leading zero is
// meaningful here, the same trap that stripped barangay_id when it was bound as
// BIGINT. Kept as a string throughout for exactly that reason.
const ZIP_CODE = /^\d{4}$/;

export const validateZipCode = (zipCode) => {
  if (typeof zipCode !== "string" || !ZIP_CODE.test(zipCode))
    return "Zip code must be exactly 4 digits";

  return null;
};
