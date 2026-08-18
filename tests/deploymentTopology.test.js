import { getDeploymentTopology } from "../src/utils/deploymentTopology.js";

describe("deployment topology", () => {
  test("detecta regiones alineadas", () => {
    const previousBackend = process.env.BACKEND_REGION;
    const previousMongo = process.env.MONGO_REGION;
    process.env.BACKEND_REGION = "Ohio";
    process.env.MONGO_REGION = "ohio";
    expect(getDeploymentTopology()).toEqual({
      backendRegion: "ohio",
      databaseRegion: "ohio",
      regionAligned: true,
    });
    if (previousBackend === undefined) delete process.env.BACKEND_REGION;
    else process.env.BACKEND_REGION = previousBackend;
    if (previousMongo === undefined) delete process.env.MONGO_REGION;
    else process.env.MONGO_REGION = previousMongo;
  });
});
