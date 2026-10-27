// Height is stored in centimetres — settled 2026-09-03, see PARK.md — and 38
// rows had to be converted from feet because nothing said so and nothing checked.
//
// The bounds are wide on purpose. They are not there to judge whether a height
// is likely; they are there to catch a value that is in the wrong unit. Every
// feet entry found in the data sat between 5 and 7, so any floor above about ten
// catches all of them. 100 also catches a transposition like 17 for 170, which a
// looser bound would let through.
//
// The ceiling clears the tallest person ever recorded with room to spare. Neither
// end should ever refuse a real employee, and the lower end deliberately admits
// heights that are medically unusual rather than assuming an average body.
const MIN_HEIGHT_CM = 100;
const MAX_HEIGHT_CM = 250;

export const validateHeight = (height) => {
    const value = Number(height);

    if (!Number.isFinite(value))
        return 'Height must be a number, in centimetres';

    if (value < MIN_HEIGHT_CM || value > MAX_HEIGHT_CM)
        return `Height must be in centimetres, between ${MIN_HEIGHT_CM} and ${MAX_HEIGHT_CM}`;

    return null;
};
