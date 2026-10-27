import { sql } from "../config/db.js";

// Deceased status, DBA request 21. Both procedures were read back on
// 2026-10-12 and are in md/DBA-PROCEDURES.md. Neither declares an OUTPUT
// parameter, and each owns a short transaction: they are called on their own.
//
// The date of death is kept in dbo.client_deaths, not on dbo.clients, so it
// never reaches the employee's own enrollment view (decided 2026-10-12).

// Marks the employee deceased, or corrects the date while no death claim
// exists. The procedure scopes HR to their companies (50161) and checks the
// date again (50162). Returns { client_id, date_of_death, marked }, where
// marked is 1 for a new mark and 0 for a correction.
//
// The date is bound from "YYYY-MM-DD" text as sql.Date, the way the birthdate
// is, which lands on the same day at +08:00.
const markDeceased = async (pool, { clientId, dateOfDeath, userId }) => {
  const result = await pool
    .request()
    .input("client_id", sql.BigInt, clientId)
    .input("date_of_death", sql.Date, dateOfDeath)
    .input("us01_user_id", sql.BigInt, userId)
    .execute("usp_upd_client_death");

  return result.recordset[0];
};

// Administrator only (50164), and only while no death claim exists (50163).
// Deletes the row; nothing records that a mark was undone (a choice made
// while writing request 21).
const undoDeceased = async (pool, { clientId, userId }) => {
  await pool
    .request()
    .input("client_id", sql.BigInt, clientId)
    .input("us01_user_id", sql.BigInt, userId)
    .execute("usp_del_client_death");
};

export default { markDeceased, undoDeceased };
