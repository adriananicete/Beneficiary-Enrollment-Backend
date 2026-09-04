import { AppError } from "../utils/AppError.js";

// Every route parameter that ends up bound to sql.BigInt has to pass this
// first. Without it a mistyped URL becomes a driver conversion error, which is
// neither an AppError nor a mapped SQL number — so errorHandler renders a
// generic 500 and writes a stack trace to the log for what is really a typo.
//
// It has bitten twice. A token longer than 64 characters on the public
// invitation endpoint, and `GET /admin/enrollments/agreements`, which has no
// route of its own and so matches /enrollments/:client_id with client_id set
// to the string "agreements".
export const isNumericId = (value) => /^\d+$/.test(String(value));

// The same rule for the other identifier a caller can hand us. An invitation
// token is 64 hex characters — crypto.randomBytes(32).toString("hex") — and the
// binding is NVarChar(64), so anything longer is refused by the driver before
// the procedure runs.
//
// It lives beside isNumericId because it is the same job: a shape checked
// before the value reaches a typed binding. It matters more than the ids do,
// because the endpoints carrying a token are public — an unauthenticated
// caller could otherwise produce a 500 and a stack trace with a long string.
export const isInvitationToken = (value) => /^[a-f0-9]{64}$/i.test(String(value));

// 404 rather than 400, and the message is the same one used for an id that
// exists but is not the caller's. An id that cannot exist is answered exactly
// like one that does not exist: a caller probing ids learns nothing from the
// difference, and a mistyped URL deserves nothing better than "not found".
export const validateIdParam = (name, message) => (req, res, next) => {
    if (!isNumericId(req.params[name]))
        return next(new AppError(message, 404));

    next();
};
