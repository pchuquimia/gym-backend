import { getMongoConnectionOptions } from "../src/config/db.js";

describe("Mongo connection options", () => {
  test("limita sockets y esperas para recuperarse de conexiones degradadas", () => {
    expect(getMongoConnectionOptions()).toMatchObject({
      serverSelectionTimeoutMS: 10_000,
      connectTimeoutMS: 10_000,
      socketTimeoutMS: 15_000,
      maxIdleTimeMS: 60_000,
      minPoolSize: 2,
      maxPoolSize: 10,
      retryReads: true,
      retryWrites: true,
    });
  });
});
