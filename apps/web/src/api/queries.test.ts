import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  apiGet: vi.fn()
}));

vi.mock("./client.js", () => ({
  apiGet: mocks.apiGet,
  apiSend: vi.fn()
}));

import { proposalsQuery } from "./queries.js";

describe("api queries", () => {
  it("serializes proposal type in proposal list requests", async () => {
    mocks.apiGet.mockResolvedValueOnce([]);
    const query = proposalsQuery("project-1", {
      status: "pending",
      proposalType: "ai_spec_entity"
    });

    const runQuery = query.queryFn as () => Promise<unknown>;
    await runQuery();

    expect(mocks.apiGet).toHaveBeenCalledWith(
      "/api/projects/project-1/proposals?status=pending&proposalType=ai_spec_entity"
    );
  });
});
