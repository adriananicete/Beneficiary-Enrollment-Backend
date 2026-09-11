// First, middle, last and suffix, skipping whichever are empty — `suffix` is
// usually "" rather than NULL, and a doubled space in a printed name reads as
// a mistake.
//
// Shared by the Excel report and the Certificate of Coverage, which print the
// same person and should print them the same way.
export const fullName = ({ first_name, middle_name, last_name, suffix }) =>
  [first_name, middle_name, last_name, suffix]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(" ");

export default fullName;
