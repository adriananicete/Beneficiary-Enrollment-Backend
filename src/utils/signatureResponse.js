import { sendStoredFile } from "./storedFileResponse.js";

// The signature leaves as an image, not as JSON. Two routes send it — HR
// viewing an enrollment and the employee viewing their own — and they send it
// the same way because this is the only place that decides how.
//
// Since 2026-10-06 the headers themselves are decided in storedFileResponse.js,
// shared with claim documents. A signature has no file name, so it goes out
// as plain "inline", exactly as before.
export const sendSignature = (res, signature) =>
  sendStoredFile(res, {
    content: signature.content,
    mimeType: signature.mime_type,
    byteSize: signature.byte_size,
  });

export default { sendSignature };
