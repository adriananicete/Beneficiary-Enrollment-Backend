import { getPool } from "../config/db.js";
import ClientModel from "../models/clientModel.js";
import DeathModel from "../models/deathModel.js";
import { AppError } from "../utils/AppError.js";
import { localIsoDate } from "../utils/localDate.js";
import { validateDateOfDeath } from "../utils/validateDateOfDeath.js";

// Marking an employee deceased, branch 5 of md/CLAIMS-AND-MESSAGING-DECISIONS.md.
// Both routes sit behind verifyClientAccess, and the procedures scope again.
//
// Marking does not touch the account (decided 2026-10-06): it closes when the
// death claim is closed, in branch 6. No email goes out (decided 2026-10-12).

// The enrollment's dates as "YYYY-MM-DD", for the readable refusals. The
// birthdate is a DATE and already arrives as text; the enrollment date is a
// datetime, read here in Philippine time.
export const timelineOf = (enrollment) => ({
  birthdate: typeof enrollment?.birthdate === "string" ? enrollment.birthdate : undefined,
  enrollmentDate:
    enrollment?.enrollment_date instanceof Date ? localIsoDate(enrollment.enrollment_date) : undefined,
});

// One route marks and corrects (decided 2026-10-12). 201 for a new mark, 200
// for a corrected date; `marked` says which.
export const markDeceased = async (req, res, next) => {
  try {
    const dateOfDeath = req.body?.date_of_death;

    // The shape and the future, before the database is asked.
    const shapeProblem = validateDateOfDeath(dateOfDeath);
    if (shapeProblem) throw new AppError(shapeProblem, 400);

    const pool = await getPool();

    // Read first, so a date before the birthdate or the enrollment gets its
    // own sentence rather than the procedure's general 50162. An employee
    // with no active enrollment still has a birthdate the procedure checks.
    const [enrollment] = await ClientModel.getEnrollmentByClientId(pool, req.params.client_id);

    const timelineProblem = validateDateOfDeath(dateOfDeath, timelineOf(enrollment));
    if (timelineProblem) throw new AppError(timelineProblem, 400);

    const row = await DeathModel.markDeceased(pool, {
      clientId: req.params.client_id,
      dateOfDeath,
      userId: req.user.user_id,
    });

    // A BIT, which the driver hands back as a boolean. Read for truth.
    const marked = Boolean(row?.marked);

    return res.status(marked ? 201 : 200).json({
      success: true,
      data: {
        client_id: req.params.client_id,
        date_of_death: row?.date_of_death ?? dateOfDeath,
        marked,
      },
      message: marked ? "Marked as deceased" : "Date of death corrected",
    });
  } catch (error) {
    next(error);
  }
};

// Administrator only, and only while no death claim exists. The route allows
// the Administrator alone; the procedure refuses anybody else as well (50164).
export const undoDeceased = async (req, res, next) => {
  try {
    const pool = await getPool();

    await DeathModel.undoDeceased(pool, {
      clientId: req.params.client_id,
      userId: req.user.user_id,
    });

    return res.status(200).json({ success: true, message: "Deceased mark removed" });
  } catch (error) {
    next(error);
  }
};
