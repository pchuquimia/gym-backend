export const loadInConcurrentPages = async ({
  fetchPage,
  pageSize,
  concurrency,
}) => {
  if (typeof fetchPage !== "function") {
    throw new TypeError("fetchPage debe ser una función");
  }
  if (!Number.isInteger(pageSize) || pageSize < 1) {
    throw new RangeError("pageSize debe ser un entero positivo");
  }
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError("concurrency debe ser un entero positivo");
  }

  const items = [];
  let pageOffset = 0;
  let hasMore = true;

  while (hasMore) {
    const pages = await Promise.all(
      Array.from({ length: concurrency }, (_, index) => {
        const page = pageOffset + index;
        return fetchPage({ page, skip: page * pageSize, limit: pageSize });
      }),
    );
    pages.forEach((page) => items.push(...page));
    hasMore = pages.every((page) => page.length === pageSize);
    pageOffset += concurrency;
  }

  return items;
};
