import {
  applyCursorFilter,
  decodeCursor,
  encodeCursor,
  paginatedResult,
} from "../src/utils/cursorPagination.js";

describe("cursor pagination", () => {
  test("codifica una frontera estable por fecha e id", () => {
    const encoded = encodeCursor({ date: "2026-08-17", _id: "training-9" });
    expect(decodeCursor(encoded)).toEqual({
      date: "2026-08-17",
      id: "training-9",
    });
  });

  test("aplica la frontera sin perder el filtro de propietario", () => {
    expect(
      applyCursorFilter(
        { ownerId: "athlete-1" },
        { date: "2026-08-17", id: "training-9" },
      ),
    ).toEqual({
      $and: [
        { ownerId: "athlete-1" },
        {
          $or: [
            { date: { $lt: "2026-08-17" } },
            { date: "2026-08-17", _id: { $lt: "training-9" } },
          ],
        },
      ],
    });
  });

  test("entrega un cursor solo cuando existe otra pagina", () => {
    const result = paginatedResult(
      [
        { date: "2026-08-17", _id: "3" },
        { date: "2026-08-16", _id: "2" },
        { date: "2026-08-15", _id: "1" },
      ],
      2,
    );
    expect(result.items).toHaveLength(2);
    expect(result.hasMore).toBe(true);
    expect(decodeCursor(result.nextCursor)).toEqual({
      date: "2026-08-16",
      id: "2",
    });
  });

  test("rechaza cursores manipulados", () => {
    expect(() => decodeCursor("invalid")).toThrow(
      "Cursor de paginacion invalido",
    );
  });
});
