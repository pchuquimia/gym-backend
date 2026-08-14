import { loadInConcurrentPages } from "../src/utils/concurrentPagination.js";

describe("concurrent pagination", () => {
  test("recupera todos los elementos sin esperar cada página en serie", async () => {
    const source = Array.from({ length: 1323 }, (_, index) => index);
    const calls = [];

    const result = await loadInConcurrentPages({
      pageSize: 200,
      concurrency: 8,
      fetchPage: async ({ page, skip, limit }) => {
        calls.push(page);
        return source.slice(skip, skip + limit);
      },
    });

    expect(result).toEqual(source);
    expect(calls).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  test("continúa con otra tanda cuando la primera está completa", async () => {
    const source = Array.from({ length: 10 }, (_, index) => index);

    const result = await loadInConcurrentPages({
      pageSize: 2,
      concurrency: 3,
      fetchPage: async ({ skip, limit }) => source.slice(skip, skip + limit),
    });

    expect(result).toEqual(source);
  });
});
