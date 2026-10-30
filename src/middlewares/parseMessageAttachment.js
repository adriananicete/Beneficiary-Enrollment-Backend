import multer from "multer";
import { AppError } from "../utils/AppError.js";
import { cleanFileName, MAX_DOCUMENT_BYTES, readDocument } from "../utils/validateDocument.js";

const makeUpload = (fieldName) => multer({
  storage: multer.memoryStorage(),
  defParamCharset: "utf8",
  limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1, fields: 1, fieldSize: 16 * 1024, parts: 2 },
}).single(fieldName);

const parse = (upload, property, optional) => (req, res, next) => {
  upload(req, res, (error) => {
    if (error) {
      if (error.code === "LIMIT_FILE_SIZE") return next(new AppError("Each attachment must be 5MB or smaller", 413));
      if (error.code === "LIMIT_FILE_COUNT" || error.code === "LIMIT_UNEXPECTED_FILE") {
        return next(new AppError("Only one attachment is allowed per message", 400));
      }
      return next(new AppError("The attachment could not be read", 400));
    }

    if (!req.file) {
      if (!optional) return next(new AppError("An attachment is required", 400));
      req[property] = null;
      return next();
    }

    const fileName = cleanFileName(req.file.originalname);
    const described = readDocument(req.file.buffer);
    if (described.error) return next(new AppError(`${fileName}: ${described.error}`, 400));

    req[property] = { fileName, content: req.file.buffer, ...described };
    return next();
  });
};

// The message composer sends an optional attachment as part of the message request.
export const parseMessageAttachment = parse(makeUpload("attachment"), "attachment", true);

// Keep the dedicated upload endpoint used by the UAT client compatible.
export const parseStandaloneMessageAttachment = parse(makeUpload("file"), "messageAttachment", false);

export default { parseMessageAttachment, parseStandaloneMessageAttachment };
