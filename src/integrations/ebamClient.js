import https from "node:https";
import { AppError } from "../utils/AppError.js";

// The other system's list of the companies it has booked (EBAM, also called GIS). Server to server: the key goes in
// the x-api-key header, and lives only in the backend's environment. It is never sent to the browser, never
// logged, and never part of an error message.
//
//   EBAM_BASE_URL  https://gis-uat.phillife.com.ph/api/ebam/external   (UAT)
//                  https://gis.phillife.com.ph/api/ebam/external       (production)
//   EBAM_API_KEY   the key the other system issued
//
// Read when a call is made, not when the file is loaded, so a test can set them and put them back.
//
// What keeps the key where it belongs:
//   - the address must be https and under phillife.com.ph, so a mistyped or changed setting cannot send the key
//     over plain HTTP or to another host;
//   - the certificate is always checked, here, whatever NODE_TLS_REJECT_UNAUTHORIZED says for the rest of the process
//     (a development machine may have it at 0 for its database; production refuses to start with it at 0);
//   - a redirect is never followed, since a redirect would carry the header to wherever it points;
//   - the answer is read only up to a size limit, and only for as long as the call may take.

const MAX_LIMIT = 500;
const ALLOWED_DOMAIN = "phillife.com.ph";
// a page of 100 companies is about a megabyte; this is a guard, not a limit anyone should meet
const MAX_BODY_BYTES = 10 * 1024 * 1024;

const settings = () => ({
  baseUrl: String(process.env.EBAM_BASE_URL ?? "").trim().replace(/\/+$/, ""),
  apiKey: String(process.env.EBAM_API_KEY ?? "").trim(),
});

export const ebamConfigured = () => {
  const { baseUrl, apiKey } = settings();

  return baseUrl !== "" && apiKey !== "";
};

const whole = (value, name, min, max) => {
  if (!Number.isInteger(value) || value < min || value > max) throw new AppError(`${name} must be a whole number from ${min} to ${max}`, 400);

  return value;
};

// The base address as a URL, or a 503 saying what is wrong with the setting (never the key).
const checkedBase = (baseUrl) => {
  let url;
  try {
    url = new URL(baseUrl);
  } catch {
    throw new AppError("EBAM_BASE_URL is not a web address.", 503);
  }

  if (url.protocol !== "https:") throw new AppError("EBAM_BASE_URL must be an https address: the key is never sent over plain HTTP.", 503);
  if (url.username || url.password) throw new AppError("EBAM_BASE_URL must not hold a user name or password.", 503);

  const host = url.hostname.toLowerCase();
  if (host !== ALLOWED_DOMAIN && !host.endsWith(`.${ALLOWED_DOMAIN}`)) throw new AppError(`EBAM_BASE_URL must be a ${ALLOWED_DOMAIN} address: the key is not sent anywhere else.`, 503);

  return url;
};

// One GET over HTTPS: { status, body } with the body as text. `requestImpl` is for tests.
const get = (url, { headers, timeoutMs, maxBytes, requestImpl }) =>
  new Promise((resolve, reject) => {
    let timer;
    const done = (settle, value) => {
      clearTimeout(timer);
      settle(value);
    };

    const request = requestImpl(url, { method: "GET", headers, rejectUnauthorized: true, minVersion: "TLSv1.2" }, (response) => {
      const chunks = [];
      let size = 0;

      response.on("data", (chunk) => {
        size += chunk.length;
        if (size > maxBytes) {
          response.destroy();
          done(reject, new AppError("The other system's answer was too large.", 502));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => done(resolve, { status: response.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
      response.on("error", (error) => done(reject, error));
    });

    // the whole call, not just a quiet connection
    timer = setTimeout(() => request.destroy(Object.assign(new Error("timed out"), { name: "TimeoutError" })), timeoutMs);
    request.on("error", (error) => done(reject, error));
    request.end();
  });

// One page of the booked companies, as the other system answers it (parsed JSON). `requestImpl`, `timeoutMs` and
// `maxBytes` are for tests.
export const fetchBookedList = async ({ page = 1, limit = MAX_LIMIT, requestImpl = https.request, timeoutMs = 15000, maxBytes = MAX_BODY_BYTES } = {}) => {
  const { baseUrl, apiKey } = settings();

  if (!baseUrl || !apiKey) throw new AppError("The booked companies list is not set up: EBAM_BASE_URL and EBAM_API_KEY are missing.", 503);

  const base = checkedBase(baseUrl);
  const url = `${base.href.replace(/\/+$/, "")}/booked-list?page=${whole(page, "page", 1, 1000000)}&limit=${whole(limit, "limit", 1, MAX_LIMIT)}`;

  let answer;
  try {
    answer = await get(url, { headers: { "x-api-key": apiKey, Accept: "application/json" }, timeoutMs, maxBytes, requestImpl });
  } catch (error) {
    if (error instanceof AppError) throw error;
    // what went wrong, in words; the cause can carry the address, which is not for the person who asked
    throw new AppError(error?.name === "TimeoutError" ? "The other system did not answer in time." : "The other system could not be reached.", 502);
  }

  if (answer.status === 401 || answer.status === 403) throw new AppError("The other system refused the key.", 502);
  if (answer.status < 200 || answer.status >= 300) throw new AppError(`The other system answered ${answer.status}.`, 502);

  try {
    return JSON.parse(answer.body);
  } catch {
    throw new AppError("The other system's answer was not JSON.", 502);
  }
};

export default { ebamConfigured, fetchBookedList };
