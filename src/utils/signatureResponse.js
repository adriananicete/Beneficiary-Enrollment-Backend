// The signature leaves as an image, not as JSON. Two routes send it — HR
// viewing an enrollment and the employee viewing their own — and they send it
// the same way because this is the only place that decides how.
//
// Written once for the reason escapeHtml was: two copies of a response shape
// drift, and the half that drifts is usually the one nobody looked at.
export const sendSignature = (res, signature) => {
  // The stored type, never a guess and never the extension of a filename we do
  // not have. It was resolved from the image's own first bytes at submit.
  res.setHeader("Content-Type", signature.mime_type);
  res.setHeader("Content-Length", signature.byte_size);

  // Rendered in the page rather than downloaded.
  res.setHeader("Content-Disposition", "inline");

  // Not cached, and this is a deliberate trade against the obvious one.
  // Caching would save re-fetching perhaps 100KB when HR reopens a record —
  // worth very little — at the cost of leaving a copy of somebody's signature
  // in the disk cache of whatever machine displayed it. HR machines are shared.
  //
  // `private` on its own would keep it out of proxies and still write it to
  // disk, which is the part that matters here.
  res.setHeader("Cache-Control", "private, no-store");

  return res.status(200).send(signature.content);
};

export default { sendSignature };
