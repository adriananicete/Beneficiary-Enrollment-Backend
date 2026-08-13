export const invitationEmailTemplate = ({ companyName, enrollmentUrl }) => {
  return {
    contentType: "HTML",
    content: `
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Individual Insurance Enrollment</title>
  </head>
  <body style="margin: 0; padding: 0; background-color: #f1f1f1">
    <table
      width="450"
      cellpadding="0"
      cellspacing="0"
      border="0"
      bgcolor="#ffffff"
      style="width: 450px; border-radius: 6px"
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
            Individual Insurance Enrollment
          </h2>

          <p style="margin: 0 0 14px 0">
            <strong>${companyName}</strong> has invited you to complete your
            insurance enrollment for your group life insurance coverage with
            PhilLife. Before you begin, please have these ready:
          </p>

          <ul style="margin: 0 0 4px 0; padding-left: 20px">
            <li style="margin-bottom: 4px">Your Employee ID number</li>
            <li style="margin-bottom: 4px">Your TIN and SSS/GSIS numbers</li>
            <li style="margin-bottom: 4px">Your complete home address</li>
            <li style="margin-bottom: 4px">
              The details of any beneficiaries you want to name &mdash; full
              name, relationship, and age
            </li>
          </ul>

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
                  background: #2c3b7d;
                  background: linear-gradient(90deg, #2c3b7d 0%, #409965 100%);
                "
              >
                <a
                  href="${enrollmentUrl}"
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
                  Enroll Now
                </a>
              </td>
            </tr>
          </table>

          <p
            style="margin: 0; font-size: 13px; line-height: 1.6; color: #555555"
          >
            <span style="text-decoration: underline; font-style: italic"
              >This link expires in <strong>7 days</strong></span
            >
            and is intended only for this email address. Please don't forward it
            to anyone else. Once you submit, you'll receive a separate email
            with your login details so you can view or update your enrollment
            later.
          </p>
        </td>
      </tr>
    </table>
  </body>
</html>


`,
  };
};
