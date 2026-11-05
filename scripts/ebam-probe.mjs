// Calls the other system's booked-list once and prints the SHAPE of what it answers: the names and kinds of
// the fields and how many there are, never a value. For finding out what to read before anything is built on it.
//
//   npm run ebam-probe              the first page, three companies
//   npm run ebam-probe -- 1 500     page 1, limit 500
import { ebamConfigured, fetchBookedList } from "../src/integrations/ebamClient.js";

const [page = "1", limit = "3"] = process.argv.slice(2);

if (!ebamConfigured()) {
  console.error("EBAM_BASE_URL and EBAM_API_KEY are not both set in .env.");
  process.exit(1);
}

// A value as its kind, an object as its fields, an array as its length and the shape of its first item.
const shapeOf = (value, depth = 0) => {
  if (value === null) return "null";
  if (Array.isArray(value)) return { array_of: value.length, first_item: value.length && depth < 4 ? shapeOf(value[0], depth + 1) : null };
  if (typeof value === "object") return depth >= 4 ? "object" : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shapeOf(item, depth + 1)]));
  return typeof value === "string" && value === "" ? "empty text" : typeof value;
};

try {
  const answer = await fetchBookedList({ page: Number(page), limit: Number(limit) });
  console.log(JSON.stringify(shapeOf(answer), null, 2));
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
