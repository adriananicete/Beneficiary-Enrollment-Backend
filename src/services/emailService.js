import config from "../config/env.js";
import { emailTemplate } from "../utils/emailTemplate.js";
import { invitationEmailTemplate } from "../utils/invitationEmailTemplate.js";
import { changeRequestEmailTemplate } from "../utils/changeRequestEmailTemplate.js";

// process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

// Refresh once fewer than this many ms remain on the token.
const TOKEN_REFRESH_MARGIN_MS = 60 * 1000;
// While a token request is in flight, hold other callers on the same promise
// for this long instead of firing their own request.
const TOKEN_INFLIGHT_HOLD_MS = 60 * 1000;

// Promise resolving to the current access token, shared by every sender.
let tokenRequest = null;
let tokenExpiresAt = 0;

const fetchAccessToken = async () => {
  const url = `https://login.microsoftonline.com/${config.smtp.tenantId}/oauth2/v2.0/token`;
  const params = new URLSearchParams();
  params.append("client_id", config.smtp.clientId);
  params.append("scope", "https://graph.microsoft.com/.default");
  params.append("client_secret", config.smtp.clientSecret);
  params.append("grant_type", "client_credentials");

  const response = await fetch(url, {
    method: "POST",
    body: params,
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(
      `MS Graph token request failed: ${response.status} ${errorText}`,
    );
  }

  const data = await response.json();
  return { token: data.access_token, expiresIn: Number(data.expires_in) };
};

const getAccessToken = () => {
  // The check and both assignments run synchronously, so callers arriving
  // together share one request instead of each starting their own.
  if (!tokenRequest || Date.now() >= tokenExpiresAt) {
    tokenExpiresAt = Date.now() + TOKEN_INFLIGHT_HOLD_MS;

    tokenRequest = fetchAccessToken()
      .then(({ token, expiresIn }) => {
        tokenExpiresAt = Date.now() + expiresIn * 1000 - TOKEN_REFRESH_MARGIN_MS;
        console.log("MS Graph token refreshed");
        return token;
      })
      .catch((error) => {
        // Never leave a rejected promise cached, or every later call replays it.
        tokenRequest = null;
        tokenExpiresAt = 0;
        throw error;
      });
  }

  return tokenRequest;
};

// Carries the HTTP status and any Retry-After on the error itself. Without it a
// caller can only read the status out of the message string, which is no basis
// for deciding whether a failure is worth retrying.
const graphSendError = (response, errorText) => {
  const error = new Error(
    `MS Graph sendMail failed: ${response.status} ${errorText}`,
  );

  error.status = response.status;

  const retryAfter = Number(response.headers.get("retry-after"));
  error.retryAfterSeconds =
    Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null;

  return error;
};

export const sendConfirmationEmail = async ({
  to,
  policyNo,
  username,
  firstName,
  lastName,
  password,
  loginUrl,
}) => {
  const accessToken = await getAccessToken();
  const sendMailUrl = `https://graph.microsoft.com/v1.0/users/${config.smtp.user}/sendMail`;

  const mailPayload = {
    message: {
      subject: "This is your account credentials",
      body: emailTemplate({policyNo, username, firstName, lastName, password, loginUrl}),
      toRecipients: [
        {
          emailAddress: {
            address: to,
          },
        },
      ],
    },
    saveToSentItems: "false",
  };

  const response = await fetch(sendMailUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(mailPayload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw graphSendError(response, errorText);
  }
};

export const sendInvitationEmail = async ({ to, companyName, enrollmentUrl }) => {
  const accessToken = await getAccessToken();
  const sendMailUrl = `https://graph.microsoft.com/v1.0/users/${config.smtp.user}/sendMail`;

  const mailPayload = {
    message: {
      subject: `You're invited to enroll — ${companyName}`,
      body: invitationEmailTemplate({companyName, enrollmentUrl}),
      toRecipients: [
        {
          emailAddress: {
            address: to,
          },
        },
      ],
    },
    saveToSentItems: "false",
  };

  const response = await fetch(sendMailUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(mailPayload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw graphSendError(response, errorText);
  }
}

// Sent to the employee after HR approves or rejects their change request. Never
// on a cancellation — that was the employee's own action.
export const sendChangeRequestDecisionEmail = async ({
  to,
  firstName,
  approved,
  reviewRemarks,
}) => {
  const accessToken = await getAccessToken();
  const sendMailUrl = `https://graph.microsoft.com/v1.0/users/${config.smtp.user}/sendMail`;
  const loginUrl = config.appUrl;

  const mailPayload = {
    message: {
      subject: approved
        ? "Your enrollment details have been updated"
        : "Your requested changes were not applied",
      body: changeRequestEmailTemplate({
        firstName,
        approved,
        reviewRemarks,
        loginUrl,
      }),
      toRecipients: [
        {
          emailAddress: {
            address: to,
          },
        },
      ],
    },
    saveToSentItems: "false",
  };

  const response = await fetch(sendMailUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(mailPayload),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw graphSendError(response, errorText);
  }
};
