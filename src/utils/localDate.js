// A date as "YYYY-MM-DD" in this process's time zone, which timezone.js sets
// to Philippine time. Not toISOString().slice(0, 10): that is the UTC date,
// and before eight in the morning it is still yesterday there.
const pad = (value) => String(value).padStart(2, "0");

export const localIsoDate = (date) =>
  `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export default { localIsoDate };
