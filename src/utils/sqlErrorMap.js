export const sqlErrorMap = {
    // Thrown by usp_sel_hr_employees, which backs the enrollment list.
    //
    // verifyToken and allowedRoles refuse these callers long before the
    // procedure runs, with one exception: a session that was already open when
    // the account was deactivated keeps its JWT until it expires — up to thirty
    // days with rememberMe. That user reaches the procedure, and until now got
    // a generic 500 where the login answers this same sentence.
    //
    // 403 rather than 401 for both, matching the login: the token is valid,
    // the account is not.
    50001: { statusCode: 403, message: 'This account is no longer active. Please contact your HR.' },
    50002: { statusCode: 403, message: 'You are not authorized to view employee information' },

    // Thrown by usp_ins_beneficiary, on the public enrollment submit path. Its
    // only caller is enrollmentService.js:107, once per beneficiary, inside the
    // backend's transaction.
    //
    // 50006 is deliberately NOT mapped. It means the enrollment row does not
    // exist — but that row was inserted moments earlier in the same
    // transaction, so it firing is a fault on our side rather than anything the
    // employee did or can act on. A generic 500 is the honest answer; the full
    // error is still logged. Same reasoning as 50076.
    //
    // 50007 is the reachable one and the form allows it: two children with the
    // same first name, or the same person entered twice.
    50007: { statusCode: 409, message: 'Two beneficiaries cannot have the same name. Please correct one and submit again.' },

    // Unreachable through validateCoverage, which requires the total to be
    // exactly 100 in whole multiples of 5 before the request reaches the
    // procedure. Mapped anyway: it is the database's own guard on the rule, and
    // if it ever fires the employee should be told what is wrong with their
    // form rather than that the server broke.
    50008: { statusCode: 400, message: 'Total beneficiary coverage cannot exceed 100%' },

    // sec.us01_usp_first_login, on the forced password change.
    //
    // In our flow this cannot mean what its text says. The controller has
    // already verified the password with bcrypt and passes the stored hash as
    // @oldpass, so the hash comparison inside the procedure matches by
    // construction. The only way it fires is the username not being found —
    // which happens when an employee id longer than the procedure's
    // @us01_username varchar(20) is truncated on the way in.
    //
    // 400 and the same uniform wording the controller uses, so the caller
    // cannot tell a missing user from a wrong password. Once the procedure's
    // parameter is widened to match the column this should be unreachable.
    50033: { statusCode: 400, message: 'Invalid Credentials' },

    // 50034, same procedure, is deliberately left unmapped. It refuses a new
    // password equal to the old one by comparing two bcrypt hashes — different
    // salts, never equal — so it cannot fire. The plaintext comparison in the
    // controller is what actually enforces that rule.

    50009: {statusCode: 409, message: 'TIN number already registered'},
    50010: {statusCode: 409, message: 'Email address already registered'},
    50019: {statusCode: 409, message: 'You have already submitted an enrollment'},
    50020: {statusCode: 404, message: 'Beneficiary not found'},
    50021: {statusCode: 409, message: 'This enrollment already has a beneficiary with that name'},
    50022: {statusCode: 409, message: 'Beneficiary could not be updated'},
    50024: {statusCode: 409, message: 'TIN number already registered'},
    50025: {statusCode: 409, message: 'Email address already registered'},
    50035: {statusCode: 409, message: 'Employee ID number already registered'},
    50036: {statusCode: 409, message: 'Email address already registered'},
    50037: { statusCode: 401, message: 'Invalid credentials' },
    50040: { statusCode: 404, message: 'User does not exist or is inactive' },
    50041: { statusCode: 409, message: 'User could not be updated' },
    50073: { statusCode: 403, message: 'Only HR users can manage enrollment invitations' },
    50074: { statusCode: 404, message: 'Active enrollment invitation does not exist' },
    50075: { statusCode: 404, message: 'Active enrollment invitation does not exist' },
    50077: { statusCode: 404, message: 'Enrollment invitation does not exist' },
    50078: { statusCode: 409, message: 'This person has already completed an enrollment' },

    // Profile change requests — usp_ins_client_change_request
    50100: { statusCode: 404, message: 'Enrollment not found' },
    50101: { statusCode: 409, message: 'You already have a pending change request' },
    50102: { statusCode: 400, message: 'Invalid address change' },
    50103: { statusCode: 400, message: 'Invalid beneficiary change' },
    50104: { statusCode: 409, message: 'TIN number already registered' },
    50105: { statusCode: 409, message: 'Email address already registered' },
    50106: { statusCode: 403, message: 'Address does not belong to this enrollment' },
    50107: { statusCode: 403, message: 'Beneficiary does not belong to this enrollment' },

    // usp_upd_client_change_request_approve
    50110: { statusCode: 404, message: 'No pending change request found' },
    50111: { statusCode: 409, message: 'This employee record is no longer active' },
    50112: { statusCode: 409, message: 'The proposed TIN number is already registered to someone else' },
    50113: { statusCode: 409, message: 'The proposed email address is already registered to someone else' },
    50114: { statusCode: 400, message: 'A beneficiary coverage percentage is invalid' },
    // The one HR actually meets. It fires when the beneficiary changes would
    // leave a total other than 100%, so the message has to say what to do.
    50115: { statusCode: 400, message: 'Approving this would leave beneficiary coverage at something other than 100%. Ask the employee to correct and resubmit.' },
    50116: { statusCode: 403, message: 'Beneficiary does not belong to this employee' },
    // The duplicate name rule, which the enrollment path has enforced as 50007
    // since the start. Approving is now the only way a beneficiary name can
    // change, so this is where it has to hold.
    //
    // HR meets this one in ordinary use — two children sharing a name, or the
    // same person added twice — so the message says what to do rather than only
    // what is wrong.
    50117: { statusCode: 409, message: 'This change would leave two beneficiaries with the same name on the enrollment. Ask the employee to correct one and resubmit.' },

    // usp_upd_client_change_request_reject
    50120: { statusCode: 404, message: 'No pending change request found' },

    // The role guard shared by the three change request read procedures.
    50130: { statusCode: 403, message: 'You are not authorized to view change requests' },

    // usp_upd_client_change_request_cancel
    // One answer for both "no longer pending" and "not yours", matching the
    // procedure. A distinct reply for each would confirm someone else's request
    // exists, so 404 is the honest status for both.
    50131: { statusCode: 404, message: 'No pending change request found' },
    50132: { statusCode: 404, message: 'No pending change request found' },

    2627: {statusCode: 409, message: 'Duplicate record'},
}