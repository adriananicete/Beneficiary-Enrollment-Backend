export const sqlErrorMap = {
    // Thrown by usp_sel_hr_employees, which backs the enrollment list.
    //
    // verifyToken and allowedRoles refuse these callers long before the
    // procedure runs, with one exception: a session that was already open when
    // the account was deactivated keeps its JWT until it expires — up to thirty
    // days with rememberMe. That user reaches the procedure, and until now got
    // a generic 500 where the login answers this same sentence.
    //
    // 403 rather than 401, matching the login: the token is valid, the
    // account is not.
    50001: { statusCode: 403, message: 'This account is no longer active. Please contact your HR.' },

    // The role guard on the same procedure, and it MOVED. It threw 50002 when
    // this file was written; the live procedure throws 50133, with the same
    // sentence. Read 2026-09-07.
    //
    // So the 50002 entry that used to sit here was dead: the number it mapped
    // was no longer thrown by the procedure the comment named, and an
    // unauthorised caller was getting a generic 500 instead of this.
    //
    // 50002 is now UNMAPPED on purpose — usp_del_beneficiary throws it for
    // 'beneficiary does not exist', which is a different thing entirely.
    // Nothing calls that procedure today, but leaving the old entry in place
    // would have meant the first caller who did got "You are not authorized to
    // view employee information" for a missing beneficiary. Same shape as the
    // 50110/50111/50112 collision.
    50133: { statusCode: 403, message: 'You are not authorized to view employee information' },

    // usp_upd_employer_settings, DBA request 19, read back 2026-10-06.
    // 50140: the company does not exist or is inactive. 50141: an HR user
    // changing a company they are not mapped to.
    50140: { statusCode: 404, message: 'Company not found' },
    50141: { statusCode: 403, message: 'You can only change the settings of your own company' },

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
    // Nearly unreachable: enrollmentService validates the id against the
    // company's active list before the transaction opens, so this only fires
    // if the classification is deactivated in the milliseconds between.
    // Mapped anyway for the same reason as 50008 — it is the database's own
    // guard on a rule we also check, and if it ever fires the employee should
    // be told what to change rather than that the server broke.
    50018: {statusCode: 400, message: 'That employee classification is no longer available. Please choose another.'},

    // Same procedure, DBA request 23, read back 2026-10-15: the class belongs
    // to another company. enrollmentService refuses that first with this same
    // sentence, so the employee hears one answer whichever guard fires.
    50180: {statusCode: 400, message: 'That classification is not available for your company'},
    50019: {statusCode: 409, message: 'You have already submitted an enrollment'},
    50020: {statusCode: 404, message: 'Beneficiary not found'},
    50021: {statusCode: 409, message: 'This enrollment already has a beneficiary with that name'},
    50022: {statusCode: 409, message: 'Beneficiary could not be updated'},
    50024: {statusCode: 409, message: 'TIN number already registered'},
    50025: {statusCode: 409, message: 'Email address already registered'},
    50035: {statusCode: 409, message: 'Employee ID number already registered'},
    50036: {statusCode: 409, message: 'Email address already registered'},
    // Spelt exactly as authService answers a wrong password. The small c here
    // once told anybody which usernames exist. authService now catches 50037
    // itself; this keeps any other caller of the login procedure in step.
    50037: { statusCode: 401, message: 'Invalid Credentials' },
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

    // Still usp_ins_client_change_request, and these three were wrong until
    // 2026-09-08. They carried the approve procedure's meanings, because both
    // procedures used 50110/50111/50112 for different things and one number can
    // only hold one message.
    //
    // The DBA renumbered on 2026-09-08 — and renumbered the *approve* procedure
    // rather than the submit one we asked for, which resolves it just as well:
    // submit keeps 110/111/112, approve moved to 118/119/120.
    //
    // 50111 is the one an employee actually met, and it told them "This employee
    // record is no longer active" — false, and it sent them to HR about an
    // account that was fine. validateEnrollmentUpdate checks that the coverage
    // totals 100 and that each beneficiary has a name, but not that the names
    // differ, so it reached here from the form.
    50110: { statusCode: 400, message: 'Every beneficiary needs a name and a coverage percentage between 1 and 100' },
    50111: { statusCode: 409, message: 'This change would leave two beneficiaries with the same name on the enrollment. Correct one and resubmit.' },
    50112: { statusCode: 400, message: 'Beneficiary coverage must total exactly 100%' },

    // usp_upd_client_change_request_approve
    //
    // 50118, 50119 and 50120 are where 50110, 50111 and 50112 went. The meanings
    // are unchanged — only the numbers moved — so these three keep the wording
    // they have had since the approve path was first mapped.
    50118: { statusCode: 404, message: 'No pending change request found' },
    50119: { statusCode: 409, message: 'This employee record is no longer active' },
    50120: { statusCode: 409, message: 'The proposed TIN number is already registered to someone else' },
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
    //
    // This entry read 50120 until 2026-09-08 and the reject procedure has never
    // thrown that. It throws 50121, and nothing was mapped to it — so rejecting
    // an already-decided request answered a generic 500, while the map looked
    // like it covered the case.
    //
    // The stale number is why nobody noticed: an entry naming the right
    // procedure and the right message hides a missing one better than an empty
    // space would. Found by comparing the map against the THROW audit rather
    // than by reading either alone.
    50121: { statusCode: 404, message: 'No pending change request found' },

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

    // Same procedure, DBA request 23: the class sent with an invitation is not
    // the company's, or is retired. Nothing sends a class yet; HR will, per
    // invitation row, from branch 6 of the onboarding effort. Mapped now so
    // that branch meets a sentence rather than a 500.
    50181: { statusCode: 400, message: 'That classification is not available for this company' },

    // ── Employee claims, DBA request 20, read back 2026-10-12 ──────────────
    //
    // The submit path checks the claim type, the file fields and the required
    // documents itself before the transaction opens, so 50151, 50153 and 50154
    // can only fire in a race: a type or requirement deactivated in the
    // moments between. Mapped anyway, as 50008 is: they are the database's own
    // guards on rules we also check.

    // usp_ins_claim. The client or the enrollment is not active.
    50150: { statusCode: 404, message: 'No active enrollment was found for this account' },
    50151: { statusCode: 400, message: 'This claim type cannot be filed here' },
    // The one an employee meets in ordinary use: filing the same type twice
    // while the first is still pending or returned.
    50152: { statusCode: 409, message: 'You already have an open claim of this type' },

    // usp_ins_claim_document and usp_chk_claim_requirements.
    50153: { statusCode: 400, message: 'That document does not belong to this claim' },
    50154: { statusCode: 400, message: 'A required document is missing' },

    // usp_upd_claim_resubmit. "Not yours" and "not returned" are one
    // refusal. claimService checks the status first and answers this same
    // sentence, so this fires only in a race.
    50155: { statusCode: 409, message: 'Only a returned claim can be resubmitted' },

    // usp_upd_claim_cancel. One answer for "not yours" and "no longer open",
    // as the change request cancel gives, so 404 for both.
    50156: { statusCode: 404, message: 'No open claim found' },

    // The role guard on HR's list and on the review. allowedRoles refuses
    // these callers first, so this is the stale-session case, as with 50130.
    50157: { statusCode: 403, message: 'You are not authorized to view or review claims' },

    // usp_upd_claim_review. "Another company's" and "not pending" are one
    // answer, as the change request review gives: a claim already decided,
    // or decided by somebody else a moment earlier.
    50158: { statusCode: 404, message: 'No pending claim found' },

    // Both checked by reviewDecisionOf before the procedure runs, so these
    // are the database's own guards on rules we also check.
    50159: { statusCode: 400, message: 'Status must be APPROVED, REJECTED or RETURNED' },
    50160: { statusCode: 400, message: 'Review remarks are required to reject or return a claim' },

    // ── Deceased status, DBA request 21, read back 2026-10-12 ─────────────
    //
    // The client is not active, or not in HR's companies. One answer for both.
    50161: { statusCode: 404, message: 'Employee not found' },
    // The procedure's own check of the date. validateDateOfDeath answers
    // each case with its own sentence first, so this is the backstop.
    50162: { statusCode: 400, message: 'The date of death is not valid' },
    // Correcting the date or undoing the mark once a death claim exists.
    50163: { statusCode: 409, message: 'This cannot be changed once a death claim has been filed' },
    // The undo route allows the Administrator alone, so this is the
    // stale-session case.
    50164: { statusCode: 403, message: 'Only an Administrator can undo a deceased mark' },
    50165: { statusCode: 409, message: 'This employee is not marked deceased' },
    // The death claim, branch 6. A second one for the same employee.
    50166: { statusCode: 409, message: 'A death claim has already been filed for this employee' },
    // Filing or closing: not the caller's company, not a death claim, or not
    // in the status the step needs. One answer for all.
    50167: { statusCode: 404, message: 'No death claim found' },
    // The role guard on all four procedures.
    50169: { statusCode: 403, message: 'You are not authorized to manage deceased status or death claims' },

    // ── Messaging, DBA request 22, read back 2026-10-12 ────────────────────
    //
    // The role guard on all six procedures. The routes refuse other roles
    // first, so this is the stale-session case, and an Administrator, who
    // has no access to messaging in v1.
    50170: { statusCode: 403, message: 'You are not authorized to use messaging' },
    // Opening a conversation with an employee who is not in HR's companies,
    // or does not exist. One answer for both.
    50171: { statusCode: 404, message: 'Employee not found' },
    // Sending to, or marking read, a conversation that is not the caller's.
    50172: { statusCode: 404, message: 'Conversation not found' },
    // The employee's account is closed, or the company is no longer theirs.
    // HR can still read it.
    50173: { statusCode: 409, message: 'This conversation can be read but no longer added to' },
    // Both checked by messageBodyOf first; the database's own guards.
    50174: { statusCode: 400, message: 'A message cannot be empty' },
    50175: { statusCode: 400, message: 'A message can be at most 2000 characters' },

    // ── The Administrator's companies, DBA request 24, read back 2026-10-15 ──
    //
    // The role guard on all twelve of that request's procedures. The routes
    // allow the Administrator only, so this is the stale-session case.
    50182: { statusCode: 403, message: 'Only an Administrator can manage companies' },
    // usp_ins_employer and usp_upd_employer. validateCompany checks the two
    // lengths first, so 50183 and 50185 are the database's own guards.
    50183: { statusCode: 400, message: 'Company code must be 1 to 20 characters' },
    50184: { statusCode: 409, message: 'That company code is already used by another company' },
    50185: { statusCode: 400, message: 'Policy number must be 1 to 12 characters' },
    50186: { statusCode: 409, message: 'That policy number is already used by another company' },
    // An id that matches no company. Also thrown when a class or an HR account
    // is added to an inactive one (branches 3 and 4).
    50187: { statusCode: 404, message: 'Company not found' },
    // The policy number is the prefix of every employee's number, and the
    // certificate reads it live, so it is fixed once one enrollment exists.
    50188: { statusCode: 409, message: 'The policy number cannot change once the company has an enrollment' },

    // The classification procedures, branch 3. validateClassification checks
    // the code's length and each benefit's value first, so 50189 and 50193 are
    // the database's own guards. 50190 is the one met in ordinary use.
    50189: { statusCode: 400, message: 'Classification code must be 1 to 20 characters' },
    50190: { statusCode: 409, message: 'That classification code is already used in this company' },
    50191: { statusCode: 404, message: 'Classification not found' },
    // The plan or rider id comes from usp_sel_benefit_types, read moments
    // earlier, so this means the catalogue changed in between.
    50192: { statusCode: 400, message: 'That benefit is not available' },
    50193: { statusCode: 400, message: 'A benefit needs either an amount above zero or a formula' },
    // scheduleService only inserts a benefit the class does not have, so this
    // is a race between two saves of the same class.
    50194: { statusCode: 409, message: 'That benefit is already on the classification' },
    50195: { statusCode: 404, message: 'Benefit not found' },

    2627: {statusCode: 409, message: 'Duplicate record'},

    // SQL Server's unique-INDEX violation, where 2627 is the unique-CONSTRAINT
    // one. The filtered indexes that hold "one open at a time" are indexes:
    // UX_client_change_requests_pending and UX_claims_open. A race that gets
    // past the procedure's own check meets this, and until 2026-10-12 it
    // answered 500. Generic for the same reason as 2627. claimService turns
    // the one it can name into the 50152 sentence.
    2601: {statusCode: 409, message: 'Duplicate record'},
}