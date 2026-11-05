import { AppError } from "../utils/AppError.js";

// The other system's list of the companies it has booked (EBAM). Server to server: the key goes in the
// x-api-key header, and lives only in the backend's environment. It is never sent to the browser, never
// logged, and never part of an error message.
//
//   EBAM_BASE_URL  https://gis-uat.phillife.com.ph/api/ebam/external   (UAT)
//                  https://gis.phillife.com.ph/api/ebam/external       (production)
//   EBAM_API_KEY   the key the other system issued
//
// Read when a call is made, not when the file is loaded, so a test can set them and put them back.

const MAX_LIMIT = 500;

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

// One page of the booked companies, as the other system answers it (parsed JSON). `fetchImpl` is for tests.
export const fetchBookedList = async ({ page = 1, limit = MAX_LIMIT, fetchImpl = fetch, timeoutMs = 15000 } = {}) => {
  const { baseUrl, apiKey } = settings();

  if (!baseUrl || !apiKey) throw new AppError("The booked companies list is not set up: EBAM_BASE_URL and EBAM_API_KEY are missing.", 503);

  const url = `${baseUrl}/booked-list?page=${whole(page, "page", 1, 1000000)}&limit=${whole(limit, "limit", 1, MAX_LIMIT)}`;

  let response;
  try {
    response = await fetchImpl(url, { headers: { "x-api-key": apiKey, Accept: "application/json" }, signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    // what went wrong, in words; the cause can carry the address, which is not for the person who asked
    throw new AppError(error?.name === "TimeoutError" ? "The other system did not answer in time." : "The other system could not be reached.", 502);
  }

  if (response.status === 401 || response.status === 403) throw new AppError("The other system refused the key.", 502);
  if (!response.ok) throw new AppError(`The other system answered ${response.status}.`, 502);

  try {
    return await response.json();
  } catch {
    throw new AppError("The other system's answer was not JSON.", 502);
  }
};

export default { ebamConfigured, fetchBookedList };
