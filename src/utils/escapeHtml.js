// Every email template builds an HTML document out of a template literal, so
// any value interpolated into one stops being text the moment it contains a
// `<` or a `"`. This is the one place that decides what to do about it.
//
// It lived as two identical private copies, in changeRequestEmailTemplate and
// credentialsEmailTemplate, while emailTemplate and invitationEmailTemplate had
// none. The split was not a judgement — the same two values, `username` and
// `password`, were escaped in one template and raw in the other. Shared here so
// the next template does not have to guess which half it belongs to.
//
// What this is not: a fix for a live vulnerability. Only one field crosses a
// user boundary — `reviewRemarks`, which HR writes and the employee reads — and
// it has been escaped since it was written. Everything else is the recipient's
// own data going to the recipient's own inbox.
export const escapeHtml = (value) =>
  String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
