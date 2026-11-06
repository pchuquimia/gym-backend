import dns from "node:dns";
import { jest } from "@jest/globals";
import {
  configureMongoDns,
  getMongoConnectionOptions,
} from "../src/config/db.js";

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

describe("Mongo DNS configuration", () => {
  const previous = process.env.MONGO_DNS_SERVERS;
  afterEach(() => {
    if (previous === undefined) delete process.env.MONGO_DNS_SERVERS;
    else process.env.MONGO_DNS_SERVERS = previous;
    jest.restoreAllMocks();
  });

  test("conserva el DNS del sistema si no hay una configuracion explicita", () => {
    delete process.env.MONGO_DNS_SERVERS;
    const setServers = jest
      .spyOn(dns, "setServers")
      .mockImplementation(() => {});
    configureMongoDns();
    process.env.MONGO_DNS_SERVERS = " , ";
    configureMongoDns();
    expect(setServers).not.toHaveBeenCalled();
  });

  test("usa los resolvers configurados antes de conectar sin duplicados", () => {
    process.env.MONGO_DNS_SERVERS = "1.1.1.1, 8.8.8.8, 1.1.1.1";
    const setServers = jest
      .spyOn(dns, "setServers")
      .mockImplementation(() => {});
    configureMongoDns();
    expect(setServers).toHaveBeenCalledWith(["1.1.1.1", "8.8.8.8"]);
  });

  test("explica una configuracion DNS invalida sin mostrar credenciales", () => {
    process.env.MONGO_DNS_SERVERS = "invalid-dns-server";
    expect(() => configureMongoDns()).toThrow(/MONGO_DNS_SERVERS/);
  });
});
