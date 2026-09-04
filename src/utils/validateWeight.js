// Weight is stored in kilogrammes. The column is decimal(5,2) and today's rows
// are consistent kilogrammes, so nothing is wrong yet — this exists so that
// stays true.
//
// It is weaker than validateHeight and the difference is worth knowing. Height
// in feet and height in centimetres do not overlap: every feet entry sat between
// 5 and 7, so a floor of 100 catches all of them. Kilogrammes and pounds overlap
// across the whole plausible human range — 70kg and 154lb are both ordinary
// numbers — so no bound can separate them. A range check on weight catches a
// typo and an absurd value. It does not catch the wrong unit.
//
// What catches the wrong unit is the frontend labelling the field, which is
// already on the list waiting to be sent. This is the floor under that, not a
// substitute for it.
//
// The bounds are wide for the same reason as height: they should never refuse a
// real employee, and they deliberately admit weights that are medically unusual
// rather than assuming an average body.
const MIN_WEIGHT_KG = 25;
const MAX_WEIGHT_KG = 300;

export const validateWeight = (weight) => {
    const value = Number(weight);

    if (!Number.isFinite(value))
        return 'Weight must be a number, in kilogrammes';

    if (value < MIN_WEIGHT_KG || value > MAX_WEIGHT_KG)
        return `Weight must be in kilogrammes, between ${MIN_WEIGHT_KG} and ${MAX_WEIGHT_KG}`;

    return null;
};
