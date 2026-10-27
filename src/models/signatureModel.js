import { sql } from "../config/db.js";

// The enrollment signature, written inside the enrollment transaction so that
// it commits with everything else or not at all. `usp_ins_client_signature`
// carries no transaction of its own â€” confirmed by reading it on 2026-09-08,
// which is what makes calling it from inside ours safe.
//
// `content` is bound as VarBinary(MAX) and the column is VARBINARY(MAX). Both
// halves matter: this data used to travel as a string into an NVarChar(500),
// and every signature ever submitted was silently cut to 500 characters.
//
// `signature_id` is declared because the procedure demands it â€” an OUTPUT
// parameter with no default is mandatory, and omitting it is refused outright
// with error 201 before the body runs. Unlike the one on
// sec.us01_usp_first_login, this one carries a real value: scope_identity()
// after a real INSERT. It is returned because the caller may want it; nothing
// uses it yet.
const insertSignature = async (pool, signatureData) => {
    const result = await pool.request()
    .input('client_id', sql.BigInt, signatureData.client_id)
    .input('content', sql.VarBinary(sql.MAX), signatureData.content)
    .input('mime_type', sql.VarChar(30), signatureData.mime_type)
    .input('byte_size', sql.Int, signatureData.byte_size)
    .input('sha256', sql.Char(64), signatureData.sha256)
    .input('source', sql.VarChar(10), signatureData.source)
    .input('created_by', sql.VarChar(50), signatureData.created_by)
    .output('signature_id', sql.BigInt)
    .execute('dbo.usp_ins_client_signature');

    return result.output.signature_id;
};

// Returns the row or undefined. The procedure answers an empty set for a client
// with no signature rather than throwing, so the 404 is the caller's to make.
//
// It carries no company scoping â€” like usp_sel_hr_employees it trusts the
// caller â€” so `verifyClientAccess` in front of the route is the whole of that
// rule, and has to stay there.
const getSignatureByClient = async (pool, clientId) => {
    const result = await pool.request()
    .input('client_id', sql.BigInt, clientId)
    .execute('dbo.usp_sel_client_signature_by_client');

    return result.recordset[0];
};

export default {
    insertSignature,
    getSignatureByClient,
};
