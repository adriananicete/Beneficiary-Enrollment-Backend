import { getPool } from "../config/db.js";
import AuditTrailModel from "../models/auditTrailModel.js";
import { AppError } from "../utils/AppError.js";
import { parsePaging, parseSearch } from "../utils/parsePaging.js";

const SECRET_KEY = /pass(word|wd|phrase)|pwd|token|secret|(^|[^a-z])(otp|pin)([^a-z]|$)|api[_-]?key|authorization|cookie/i;
const FILE_KEY = /document|attachment|(^|[_-])file([_-]|$)|signature|image|binary|base64/i;
const REDACTED = "[REDACTED]";
const OMITTED = "[OMITTED]";

const sanitizeAuditValue = (value) => {
  if (Array.isArray(value))
    return value.map((item) => sanitizeAuditValue(item));
  if (!value || typeof value !== "object") return value;

  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      SECRET_KEY.test(key)
        ? REDACTED
        : FILE_KEY.test(key)
          ? OMITTED
          : sanitizeAuditValue(nested),
    ]),
  );
};

const safeJson = (value) => {
  if (typeof value !== "string") return "";
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== "object") return "";
    return JSON.stringify(sanitizeAuditValue(parsed));
  } catch {
    return "";
  }
};

const auditEntryOf = (row) => ({
  ...row,
  old_values: safeJson(row.old_values),
  new_values: safeJson(row.new_values),
});

const parseDate = (value, name) => {
  if (value === undefined || value === "") return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new AppError(`${name} must be a date in YYYY-MM-DD format`, 400);

  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value ||
    value > "9998-12-31"
  )
    throw new AppError(`${name} must be a valid date`, 400);

  return value;
};

export const createGetAuditTrail = ({ getPool, model }) => async (req, res, next) => {
  try {
    const { page, pageSize } = parsePaging(req.query);
    const offset = (page - 1) * pageSize;
    if (!Number.isSafeInteger(offset))
      throw new AppError("page is out of range", 400);

    const search = parseSearch(req.query.search);
    if (search && search.length > 100)
      throw new AppError("search must be 100 characters or fewer", 400);

    const status = req.query.status || null;
    if (status !== null && !["SUCCESS", "FAILED"].includes(status))
      throw new AppError("status must be SUCCESS or FAILED", 400);

    const from = parseDate(req.query.from, "from");
    const to = parseDate(req.query.to, "to");
    if (from && to && from > to)
      throw new AppError("from must be on or before to", 400);

    const pool = await getPool();
    const result = await model.getAuditTrail(pool, {
      page,
      pageSize,
      search,
      status,
      from,
      to,
    });

    return res.status(200).json({
      success: true,
      data: {
        rows: result.rows.map(auditEntryOf),
        page,
        pageSize,
        total: result.total,
        totalPages: Math.ceil(result.total / pageSize),
      },
    });
  } catch (error) {
    next(error);
  }
};

export const getAuditTrail = createGetAuditTrail({
  getPool,
  model: AuditTrailModel,
});
