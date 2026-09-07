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

    // usp_ins_client, added by the DBA on 2026-09-07 at our request.
    //
    // Before it existed, a duplicate SSS number was not refused by the
    // procedure at all — dbo.clients has a UNIQUE index on sss_gsis_no and
    // nothing checked it, so the caller got SQL Server's own 2627, which this
    // file can only render as "Duplicate record". That message names no field,
    // so the employee had nothing to act on.
    //
    // Worth keeping: 2627 fires for any unique violation on any table, so it
    // can never say which column. A mapped number is the only way this becomes
    // a sentence somebody can use.
    //
    // The check behind it deliberately has no `status = 'A'` filter, unlike
    // 50009 above. The index has no such filter either, and a check narrower
    // than its constraint leaves the raw 2627 in exactly the case that is
    // hardest to explain — a returning employee whose own client row was
    // deactivated. PARK.md §3.
    50083: {statusCode: 409, message: 'SSS/GSIS number already registered'},

    // ── usp_ins_insurance_enrollment: the configuration faults ──────────────
    //
    // These three are the first 5xx entries in this file, and the status code
    // is deliberate. Nothing the employee did caused them and nothing they can
    // type will fix them, so 4xx would be a lie — but a bare 500 says "Server
    // Error", which sends them back to the form to try again forever.
    //
    // A mapped entry's message is returned verbatim whatever the status code
    // (errorHandler.js:14), so mapping to 500 keeps the honest class and still
    // gives them a sentence: stop, and go to HR. The full error is logged.
    //
    // Whoever adds a 4xx here later should check that the caller can actually
    // act on it. That is the whole line between these and the 409s above.

    // The likeliest of the three by a distance. Onboarding a company means
    // creating an employer row, and nothing forces policy_no to be filled —
    // usp_ins_insurance_enrollment builds every policy number from it. Miss it
    // and EVERY enrollment for that company fails from the first invitation
    // onward, with the cause one column away in a table the employee cannot
    // see. DBA-OUTBOX question 3b asks which employers are missing it.
    50071: {statusCode: 500, message: 'Your company is not set up for enrollment yet. Please contact your HR.'},

    // The policy sequence for this company and year has passed 99999. Far off,
    // and a real ceiling rather than a fault — mapped while the file is open
    // because the day it fires nobody will remember this procedure generates
    // the number itself.
    50072: {statusCode: 500, message: 'This company has reached its enrollment limit for the year. Please contact your HR.'},

    // ── us04_usp_assign_role ────────────────────────────────────────────────
    //
    // Role id 3 — EMPLOYEE_ROLE_ID — has been deactivated. Unguarded: nothing
    // pre-checks it, unlike the classification below. It would take down every
    // enrollment in the system rather than one company's, and the message must
    // not mention roles, which mean nothing to the person reading it.
    50052: {statusCode: 500, message: 'Enrollment is not available right now. Please contact your HR.'},

    // ── usp_ins_insurance_enrollment: the one the caller can act on ─────────
    //
    // 400 rather than 500, and that is the whole distinction. The employee
    // picked a classification that has since been deactivated, and choosing a
    // different one fixes it.
    //
    // Nearly unreachable: enrollmentService.js:51 validates the id against the
    // active list before the transaction opens, so this only fires if the
    // classification is deactivated in the milliseconds between. Mapped anyway
    // for the same reason as 50008 — it is the database's own guard on a rule
    // we also check, and if it ever fires the employee should be told what to
    // change rather than that the server broke.
    50018: {statusCode: 400, message: 'That employee classification is no longer available. Please choose another.'},
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

    // Same procedure, found in the full THROW audit on 2026-09-07. Both mean
    // the beneficiary change block did not parse into something usable —
    // 50108 an action outside the allowed set, 50109 an id that does not go
    // with the action given.
    //
    // The employee cannot fix either from the form; the cause is the payload.
    // 400 is still right, because it is the request that is wrong, and the
    // wording matches 50102 and 50103 above rather than inventing a new voice.
    //
    // Worth knowing why they fire at all: the JSON keys inside a change
    // request are camelCase, alone in this API, because that is OPENJSON's
    // contract — and a wrong key does not error, it reads as NULL. So a typo
    // in the frontend arrives here rather than at the point it was made.
    50108: { statusCode: 400, message: 'Invalid beneficiary change action' },
    50109: { statusCode: 400, message: 'Invalid beneficiary reference in the change request' },
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

    // ── The read paths, from the full THROW audit on 2026-09-07 ────────────
    //
    // One query over sys.sql_modules listed every THROW in every procedure,
    // which is the audit PARK.md §6 had been asking for since 2026-09-03.
    // These are the numbers it found on procedures this backend actually
    // calls. Everything below was a generic 500 until now.

    // us01_usp_sel_user_by_id, reached from getMyAgreements.
    // us01_usp_sel_user_by_username throws 50039 for the same reason and is
    // not called here, so it is not mapped.
    //
    // Same class as 50001 and the same sentence, deliberately: verifyToken and
    // allowedRoles refuse an inactive account long before this, with one
    // exception — a session already open when the account was deactivated
    // keeps its JWT until it expires, up to thirty days with rememberMe.
    50038: { statusCode: 403, message: 'This account is no longer active. Please contact your HR.' },

    // usp_sel_beneficiaries. The enrollment id comes from the employee's own
    // record moments earlier, so this means the enrollment vanished between
    // the two reads — or that they have none.
    50079: { statusCode: 404, message: 'Enrollment not found' },

    // usp_sel_client_agreement, behind the consent records on both the
    // employee and the admin side.
    50081: { statusCode: 404, message: 'Enrollment not found' },

    // usp_sel_insurance_enrollment. 50082 is a user row with no client_id —
    // an account that exists but was never linked to an enrollment, which is
    // exactly the state a half-finished manual seed leaves behind. The
    // employee can do nothing with it except be told who to ask.
    50082: { statusCode: 404, message: 'No enrollment is linked to this account. Please contact your HR.' },

    // Same procedure, the role guard. allowedRoles(EMPLOYEE) already refuses
    // these callers, so this is the stale-session case again.
    50134: { statusCode: 403, message: 'This account cannot view employee enrollment details' },

    // usp_ins_enrollment_invitation, on the HR send path. The company itself
    // is inactive, which HR cannot fix and would otherwise see as a server
    // error in the middle of a bulk send.
    //
    // 50064 from the same procedure is NOT mapped and must not be: it means
    // an active invitation already exists for that address, and
    // invitationService.js:99 catches it to mark that one recipient
    // `already_invited` rather than failing the send. Mapping it here would
    // do nothing, but the next person reading this file should know it is
    // handled rather than missed.
    50063: { statusCode: 409, message: 'This company is no longer active. Please contact PhilLife.' },

    2627: {statusCode: 409, message: 'Duplicate record'},
}