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
