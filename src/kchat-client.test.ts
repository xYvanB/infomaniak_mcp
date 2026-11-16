/**
 * Unit tests for KChatClient
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { KChatClient } from "./kchat-client.js";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

function ok(data: unknown) {
  return { ok: true, status: 200, json: () => Promise.resolve(data) };
}

describe("KChatClient", () => {
  let client: KChatClient;

  beforeEach(() => {
    vi.restoreAllMocks();
    mockFetch.mockReset();
    mockFetch.mockResolvedValue(ok({}));
    client = new KChatClient({ host: "team.kchat.infomaniak.com", token: "test-token" });
  });

  describe("searchUsers", () => {
    it("sends POST /users/search with the term in the body", async () => {
      mockFetch.mockResolvedValueOnce(ok([]));

      await client.searchUsers("alice");

      expect(mockFetch).toHaveBeenCalledWith(
        "https://team.kchat.infomaniak.com/api/v4/users/search",
        expect.objectContaining({ method: "POST", body: JSON.stringify({ term: "alice" }) }),
      );
    });
  });

  describe("timeout", () => {
    it("gives up on a request that never answers", async () => {
      // A fetch that only settles when its signal aborts
      mockFetch.mockImplementationOnce(
        (_url: string, options: RequestInit) =>
          new Promise((_resolve, reject) => {
            options.signal?.addEventListener("abort", () => reject(options.signal?.reason));
          }),
      );
      client = new KChatClient({ host: "team.kchat.infomaniak.com", token: "test-token", timeoutMs: 20 });

      await expect(client.getMe()).rejects.toThrow();
    }, 2000);

    it("uses a 30 second timeout by default", async () => {
      const timeoutSpy = vi.spyOn(AbortSignal, "timeout");

      await client.getMe();

      expect(timeoutSpy).toHaveBeenCalledWith(30_000);
    });
  });
});
