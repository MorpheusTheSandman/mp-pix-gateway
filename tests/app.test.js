const request = require("supertest");
const app = require("../src/app");

jest.mock("../src/db", () => ({
  query: jest.fn(),
  pool: {
      query: jest.fn()
  }
}));

// Mock logger to avoid noise
jest.mock("pino-http", () => () => (req, res, next) => next());

describe("API Endpoints", () => {
  it("GET /api/config should return configuration", async () => {
    const res = await request(app).get("/api/config");
    expect(res.statusCode).toEqual(200);
    expect(res.body).toHaveProperty("mpPublicKey");
  });

  it("GET /nonexistent should return 404", async () => {
    const res = await request(app).get("/api/nonexistent");
    expect(res.statusCode).toEqual(404);
  });
});
