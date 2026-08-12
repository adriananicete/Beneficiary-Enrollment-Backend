export const validateCoverage = (beneficiaries) => {
    let total = 0;
    if(!Array.isArray(beneficiaries)) return 'Beneficiaries must be an array';
    if(beneficiaries.length === 0) return null;
    if(beneficiaries.length > 10) return 'A maximum of 10 beneficiaries is allowed'

    for(let i = 0; i < beneficiaries.length; i++) {
        const value = Number(beneficiaries[i].coverage_percent);
        if(!Number.isInteger(value)) return `Beneficiary ${i + 1}: coverage percent must be a whole number`

        if(value < 5 || value > 100) return `Beneficiary ${i + 1}: coverage percent must be between 5 and 100`;
        if( value % 5 !== 0) return `Beneficiary ${i + 1}: coverage percent must be a multiple of 5`;

        beneficiaries[i].coverage_percent = value;
        total += value;

    }

    if(total !== 100) return `Total beneficiary coverage must be exactly 100% (currently ${total}%)`;
    return null
}