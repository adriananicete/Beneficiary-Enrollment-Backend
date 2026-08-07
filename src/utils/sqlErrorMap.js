export const sqlErrorMap = {
    50009: {statusCode: 409, message: 'TIN number already registered'},
    50010: {statusCode: 409, message: 'Email address already registered'},
    50019: {statusCode: 409, message: 'You have already submitted an enrollment'},
    50024: {statusCode: 409, message: 'TIN number already registered'},
    50025: {statusCode: 409, message: 'Email address already registered'},
    50035: {statusCode: 409, message: 'Employee ID number already registered'},
    50036: {statusCode: 409, message: 'Email address already registered'},
    50037: { statusCode: 401, message: 'Invalid credentials' },
    2627: {statusCode: 409, message: 'Duplicate record'},
}