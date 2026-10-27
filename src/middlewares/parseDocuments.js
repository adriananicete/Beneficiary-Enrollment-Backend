import multer from "multer";
import { AppError } from "../utils/AppError.js";
import {
  MAX_DOCUMENTS,
  MAX_DOCUMENT_BYTES,
  cleanFileName,
  readDocument,
} from "../utils/validateDocument.js";

// Multipart uploads, for claim documents. The project's first multipart
// parser, added 2026-10-06. SIGNATURE-UPLOAD-DECISIONS.md kept the signature
// as base64 inside JSON and named supporting documents as the case that would
// change that: a scanned certificate of several megabytes does not belong in
// a JSON body.
//
// Held in memory, never written to disk. Each document goes into the database
// with its claim, the way the signature does, so there is no file to orphan
// and no path to traverse. The limits below bound that memory: 10 files of
// 5MB.
//
// Any field name is accepted, because a claim names one field per required
// document, and those differ by claim type. The route that uses this decides
// which field names are allowed. Text fields arrive on req.body as usual.
//
// What it leaves on the request: req.documents, an array of
//   { field, fileName, content, mimeType, byteSize, sha256 }
// with each file's type read from its bytes. Empty when the request carried
// no files or was not multipart.

// defParamCharset: busboy reads a file name as latin1 unless told otherwise.
// Measured on 2026-10-06: "Peña ID.jpg" arrived as "PeÃ±a ID.jpg". Browsers
// send UTF-8, and Filipino names carry ñ.
const upload = multer({
  storage: multer.memoryStorage(),
  defParamCharset: "utf8",
  limits: {
    fileSize: MAX_DOCUMENT_BYTES,
    files: MAX_DOCUMENTS,
    fields: 20,
    fieldSize: 16 * 1024,
    parts: MAX_DOCUMENTS + 20,
  },
}).any();

// multer reports a broken limit as a MulterError with no HTTP status, which
// errorHandler would answer as a 500. Each is turned into the refusal it is.
const LIMITS = {
  LIMIT_FILE_SIZE: [413, "Each document must be 5MB or smaller"],
  LIMIT_FILE_COUNT: [400, `No more than ${MAX_DOCUMENTS} documents can be uploaded at once`],
};

const UNREADABLE = [400, "The upload could not be read"];

export const parseDocuments = (req, res, next) => {
  upload(req, res, (error) => {
    if (error) {
      const [status, message] = LIMITS[error.code] ?? UNREADABLE;
      return next(new AppError(message, status));
    }

    const documents = [];

    for (const file of req.files ?? []) {
      const fileName = cleanFileName(file.originalname);
      const described = readDocument(file.buffer);

      // Named, so the uploader knows which of several files to replace. The
      // name is their own, cleaned, and goes back only to them.
      if (described.error)
        return next(new AppError(`${fileName}: ${described.error}`, 400));

      documents.push({
        field: file.fieldname,
        fileName,
        content: file.buffer,
        ...described,
      });
    }

    req.documents = documents;

    next();
  });
};

export default { parseDocuments };
