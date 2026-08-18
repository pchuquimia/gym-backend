const INVALID_CURSOR = "Cursor de paginacion invalido";

const invalidCursor = () => {
  const error = new Error(INVALID_CURSOR);
  error.statusCode = 400;
  return error;
};

export const encodeCursor = (document) => {
  if (!document?.date || !document?._id) return null;
  return Buffer.from(
    JSON.stringify({ date: String(document.date), id: String(document._id) }),
  ).toString("base64url");
};

export const decodeCursor = (value) => {
  if (!value) return null;
  try {
    const parsed = JSON.parse(
      Buffer.from(String(value), "base64url").toString("utf8"),
    );
    if (!parsed?.date || !parsed?.id) throw invalidCursor();
    return { date: String(parsed.date), id: String(parsed.id) };
  } catch (error) {
    if (error?.statusCode === 400) throw error;
    throw invalidCursor();
  }
};

export const applyCursorFilter = (filter, cursor) => {
  if (!cursor) return filter;
  const boundary = {
    $or: [
      { date: { $lt: cursor.date } },
      { date: cursor.date, _id: { $lt: cursor.id } },
    ],
  };
  return { $and: [filter, boundary] };
};

export const paginatedResult = (documents, limit) => {
  const hasMore = documents.length > limit;
  const items = hasMore ? documents.slice(0, limit) : documents;
  return {
    items,
    hasMore,
    nextCursor: hasMore ? encodeCursor(items.at(-1)) : null,
  };
};
