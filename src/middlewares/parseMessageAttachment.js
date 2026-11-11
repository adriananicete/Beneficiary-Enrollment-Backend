import multer from "multer";
import { AppError } from "../utils/AppError.js";
import { MAX_DOCUMENT_BYTES, cleanFileName, readDocument } from "../utils/validateDocument.js";

// One file sent with a message (DBA request 29, decided 2026-11-11): PDF, JPG or PNG, 5MB, read
// from its bytes as claim documents are, and held in memory only. Ported from the teammates'
// parseMessageAttachment, with their two field names, so the frontend built against UAT keeps
// working:
//
//   POST …/messages     field `attachment`, optional: a message may be text, a file, or both
//   POST …/attachments  field `file`, required: their dedicated upload, the same message after it
//
// A request that is not multipart passes through untouched, so a JSON text message works as before.
// The text, when there is one, is the multipart field `body`.
//
// What it leaves on the request: req.attachment, { fileName, content, mimeType, byteSize, sha256 },
// or null when no file came.

const uploadOf = (field) =>
  multer({
    storage: multer.memoryStorage(),
    // busboy reads a file name as latin1 unless told otherwise; Filipino names carry ñ.
    defParamCharset: "utf8",
    limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1, fields: 1, fieldSize: 16 * 1024, parts: 2 },
  }).single(field);

export const ATTACHMENT_TOO_LARGE = "Each attachment must be 5MB or smaller";
export const ONE_ATTACHMENT = "Only one attachment can be sent with a message";
export const ATTACHMENT_REQUIRED = "An attachment is required";
export const ATTACHMENT_UNREADABLE = "The attachment could not be read";

// multer reports a broken limit as a MulterError with no HTTP status, which errorHandler would
// answer as a 500. Each is turned into the refusal it is. A second file, or a file under another
// field name, are both LIMIT_UNEXPECTED_FILE or LIMIT_FILE_COUNT.
const REFUSALS = {
  LIMIT_FILE_SIZE: [413, ATTACHMENT_TOO_LARGE],
  LIMIT_FILE_COUNT: [400, ONE_ATTACHMENT],
  LIMIT_UNEXPECTED_FILE: [400, ONE_ATTACHMENT],
};

const parseWith = (field, required) => {
  const upload = uploadOf(field);

  return (req, res, next) => {
    upload(req, res, (error) => {
      if (error) {
        const [status, message] = REFUSALS[error.code] ?? [400, ATTACHMENT_UNREADABLE];
        return next(new AppError(message, status));
      }

      if (!req.file) {
        if (required) return next(new AppError(ATTACHMENT_REQUIRED, 400));

        req.attachment = null;
        return next();
      }

      const fileName = cleanFileName(req.file.originalname);
      const described = readDocument(req.file.buffer);

      // readDocument speaks of "documents", as claims do; a message's file is an attachment.
      if (described.error) {
        const problem = described.error.replace(/document/g, "attachment").replace(/Document/g, "Attachment");
        return next(new AppError(`${fileName}: ${problem}`, 400));
      }

      req.attachment = { fileName, content: req.file.buffer, ...described };
      next();
    });
  };
};

export const parseMessageAttachment = parseWith("attachment", false);
export const parseAttachmentUpload = parseWith("file", true);

export default { parseMessageAttachment, parseAttachmentUpload };
