import config from "../config/env.js";
import { emailTemplate } from "../utils/emailTemplate.js";

// process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const getAccessToken = async () => {
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
  return data.access_token;
};

export const sendConfirmationEmail = async ({
  to,
  referenceNumber,
  username,
  password,
  loginUrl,
}) => {
  const accessToken = await getAccessToken();
  const sendMailUrl = `https://graph.microsoft.com/v1.0/users/${config.smtp.user}/sendMail`;

  const mailPayload = {
    message: {
      subject: "This is your account credentials",
      body: emailTemplate({referenceNumber, username, password, loginUrl}),
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
    throw new Error(
      `MS Graph sendMail failed: ${response.status} ${errorText}`,
    );
  }
};
