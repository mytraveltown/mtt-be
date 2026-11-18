const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 100;

/**
 * Pagination is opt-in: callers that do not send `page` keep the legacy
 * (unpaginated) behaviour so existing consumers are not broken.
 */
const isPaginationRequested = (query) =>
  query.page !== undefined && query.page !== "";

const parsePagination = (query, { defaultLimit = DEFAULT_LIMIT, maxLimit = MAX_LIMIT } = {}) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(maxLimit, Math.max(1, parseInt(query.limit, 10) || defaultLimit));
  return { page, limit, offset: (page - 1) * limit };
};

const buildPaginationMeta = ({ page, limit, total }) => {
  const totalPages = Math.ceil(total / limit) || 1;
  return { page, limit, total, totalPages, hasMore: page < totalPages };
};

module.exports = { isPaginationRequested, parsePagination, buildPaginationMeta };
