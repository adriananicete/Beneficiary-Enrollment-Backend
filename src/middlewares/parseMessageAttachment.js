import multer from "multer";
import { AppError } from "../utils/AppError.js";
import { readDocument, cleanFileName, MAX_DOCUMENT_BYTES } from "../utils/validateDocument.js";
const upload = multer({storage:multer.memoryStorage(),defParamCharset:"utf8",
  limits:{fileSize:MAX_DOCUMENT_BYTES,files:1,fields:1,fieldSize:8000,parts:2},
}).single("file");
export const parseMessageAttachment = (req,res,next) => {
  upload(req,res,error => {
    if(error) return next(new AppError(error.code === "LIMIT_FILE_SIZE" ? "Attachment must be 5MB or smaller" : "Upload one PDF, JPG or PNG attachment per message",error.code === "LIMIT_FILE_SIZE" ? 413 : 400));
    if(!req.file) return next(new AppError("An attachment is required",400));
    const described=readDocument(req.file.buffer);
    if(described.error) return next(new AppError(described.error,400));
    req.messageAttachment={...described,content:req.file.buffer,fileName:cleanFileName(req.file.originalname)};
    next();
  });
};
