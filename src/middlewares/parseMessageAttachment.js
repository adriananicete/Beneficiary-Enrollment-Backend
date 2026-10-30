import multer from "multer";
import { AppError } from "../utils/AppError.js";
import { cleanFileName, MAX_DOCUMENT_BYTES, readDocument } from "../utils/validateDocument.js";

const upload = multer({
  storage: multer.memoryStorage(),
  defParamCharset: "utf8",
  limits: { fileSize: MAX_DOCUMENT_BYTES, files: 1, fields: 1, fieldSize: 16 * 1024, parts: 2 },
}).single("attachment");

export const parseMessageAttachment = (req, res, next) => {
  upload(req, res, (error) => {
    if (error) {
      if (error.code === "LIMIT_FILE_SIZE") return next(new AppError("Each attachment must be 5MB or smaller", 413));
      if (error.code === "LIMIT_FILE_COUNT" || error.code === "LIMIT_UNEXPECTED_FILE") {
        return next(new AppError("Only one attachment is allowed per message", 400));
      }
      return next(new AppError("The attachment could not be read", 400));
    }

    if (!req.file) {
      req.attachment = null;
      return next();
    }

    const fileName = cleanFileName(req.file.originalname);
    const described = readDocument(req.file.buffer);
    if (described.error) return next(new AppError(`${fileName}: ${described.error}`, 400));

    req.attachment = { fileName, content: req.file.buffer, ...described };
    return next();
  });
};

export default { parseMessageAttachment };
