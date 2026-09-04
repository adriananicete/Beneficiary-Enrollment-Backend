// Its own file so the cap lives in one place, and so the enrollment list and
// the change request list reuse it rather than each deriving their own.
//
// An uncapped page size hands the whole problem back to the caller — one
// request for 100,000 rows undoes everything paging was for. The procedure
// clamps to 100 as well, so a caller reaching it directly is still bounded;
// this is the same rule stated where the API can answer for it.
export const DEFAULT_PAGE_SIZE = 25;
export const MAX_PAGE_SIZE = 100;

// Anything unparseable becomes the default rather than an error. A bad `page`
// in a query string is a caller mistake with an obvious right answer, and
// answering 400 to it would break a list that could simply have been shown.
const toPositiveInt = (value, fallback) => {
    const parsed = Number(value);

    if (!Number.isInteger(parsed) || parsed < 1) return fallback;

    return parsed;
};

export const parsePaging = (query = {}) => {
    const page = toPositiveInt(query.page, 1);
    const pageSize = Math.min(
        toPositiveInt(query.pageSize, DEFAULT_PAGE_SIZE),
        MAX_PAGE_SIZE,
    );

    return { page, pageSize };
};

// The response envelope, in the same file as the parameters that produce it,
// so the contract is one thing rather than a shape each list reinvents.
//
// `total` comes off COUNT(*) OVER() on the first row, which the procedures
// carry so the count costs no second query. **It has to default to 0**: a
// filtered set with no matches returns no rows at all, and therefore no count
// either, so reading it off row zero without a guard yields `undefined` rows
// out of a `NaN` page count. That is the one way this shape breaks.
//
// `transform` is for a list that has to drop something before the rows leave
// the server — the invitation list strips `token`, which is the credential
// that opens the enrollment form as the invited person.
export const buildPage = (records, { page, pageSize }, transform = (row) => row) => {
    const total = records.length > 0 ? records[0].total_count : 0;

    const rows = records.map(({ total_count, ...record }) => transform(record));

    return {
        rows,
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
    };
};
