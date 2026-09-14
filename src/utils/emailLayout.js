// The shell every email shares: the logo, the card, the background and the
// heading. Each template supplies a title, a heading and its own body.
//
// Extracted 2026-09-14, for the same reason escapeHtml.js was extracted in
// PR #89. Five templates held five copies of this markup, four of them
// identical and one — the enrollment confirmation — a different design
// altogether, so "what does our email look like" had no single answer. Centring
// the card meant getting the same change right in five places, and the next
// change would have meant it again.
//
// The email-client constraints behind the odd-looking markup, none of which are
// preferences:
//
//   Tables, not divs. Outlook renders through Word, which does not lay out
//   floats or flex and ignores most positioning.
//
//   `align="center"` on the outer cell, not `margin: 0 auto` on the card.
//   Word ignores auto margins, so the card would sit hard against the left
//   edge — which is exactly what all five templates did until now.
//
//   The width is given twice, as the attribute Word reads and the property
//   everything else reads, plus `max-width: 100%` so a 450 card does not
//   overflow a 400-wide phone.
//
//   Inline styles throughout. Gmail strips <style> blocks.
export const emailLayout = ({ title, heading, body }) => ({
  contentType: "HTML",
  content: `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title}</title>
  </head>
  <body style="margin: 0; padding: 0; background-color: #f1f1f1">
    <table
      width="100%"
      cellpadding="0"
      cellspacing="0"
      border="0"
      bgcolor="#f1f1f1"
      style="width: 100%; background-color: #f1f1f1"
    >
      <tr>
        <td align="center" style="padding: 24px 12px">
          <table
            width="450"
            cellpadding="0"
            cellspacing="0"
            border="0"
            bgcolor="#ffffff"
            style="width: 450px; max-width: 100%; border-radius: 6px"
          >
            <!-- logo -->
            <tr>
              <td align="center" style="padding: 28px 26px 0 26px">
                <img
                  src="https://res.cloudinary.com/dks2psaem/image/upload/v1786525078/PhilLife_Color_tcjvib.png"
                  width="260"
                  alt="PhilLife"
                  style="
                    display: block;
                    width: 260px;
                    max-width: 100%;
                    height: auto;
                    border: 0;
                    outline: none;
                    text-decoration: none;
                  "
                />
              </td>
            </tr>

            <!-- content -->
            <tr>
              <td
                style="
                  padding: 20px 26px 28px 26px;
                  font-family:
                    &quot;Segoe UI&quot;, Tahoma, Geneva, Verdana, sans-serif;
                  font-size: 15px;
                  line-height: 1.6;
                  color: #333333;
                "
              >
                <h2
                  style="
                    margin: 0 0 16px 0;
                    color: #1a1760;
                    font-size: 20px;
                    text-align: center;
                  "
                >
                  ${heading}
                </h2>
${body}
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
`,
});

// The green-bordered box the credentials, policy number and certificate emails
// all put their one important value in. Centred text inside a left-aligned
// body, which is the pattern those three already used.
export const emailCallout = (content) => `
                <table
                  width="100%"
                  cellpadding="0"
                  cellspacing="0"
                  border="0"
                  style="width: 100%; margin: 18px 0"
                >
                  <tr>
                    <td
                      align="center"
                      style="
                        padding: 16px 12px;
                        border: 1px solid #409965;
                        border-radius: 6px;
                        font-size: 16px;
                        line-height: 1.8;
                        color: #1a1760;
                      "
                    >
${content}
                    </td>
                  </tr>
                </table>`;

// The gradient call to action. A table rather than a styled anchor, because
// Word will not paint a background on an inline element — the anchor fills the
// cell and the cell carries the colour.
//
// The gradient is a progressive enhancement: `bgcolor` is the flat fallback
// every client understands, and the clients that support `linear-gradient`
// paint over it. Both are needed.
export const emailButton = ({ href, label }) => `
                <table
                  width="100%"
                  cellpadding="0"
                  cellspacing="0"
                  border="0"
                  style="width: 100%; margin: 22px 0"
                >
                  <tr>
                    <td
                      width="100%"
                      align="center"
                      bgcolor="#2c3b7d"
                      style="
                        width: 100%;
                        padding: 12px 0;
                        border-radius: 5px;
                        background: linear-gradient(90deg, #2c3b7d 0%, #409965 100%);
                      "
                    >
                      <a
                        href="${href}"
                        target="_blank"
                        rel="noopener noreferrer"
                        style="
                          display: block;
                          color: #ffffff;
                          font-family:
                            &quot;Segoe UI&quot;, Tahoma, Geneva, Verdana, sans-serif;
                          font-size: 15px;
                          font-weight: bold;
                          line-height: 20px;
                          text-decoration: none;
                          text-align: center;
                        "
                      >
                        ${label}
                      </a>
                    </td>
                  </tr>
                </table>`;

// The small print each email closes with.
export const emailNote = (content) => `
                <p style="margin: 0; font-size: 13px; line-height: 1.6; color: #555555">
${content}
                </p>`;

export default { emailLayout, emailCallout, emailButton, emailNote };
