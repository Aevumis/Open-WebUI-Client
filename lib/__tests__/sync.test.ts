import {
  fullSync,
  incrementalSync,
  isFullSyncDone,
  maybeFullSync,
  forceSyncReset,
  manualSync,
} from "../sync";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as outbox from "../outbox";
import * as cache from "../cache";

// Mock dependencies
jest.mock("@react-native-async-storage/async-storage", () =>
  require("@react-native-async-storage/async-storage/jest/async-storage-mock")
);

jest.mock("../outbox", () => ({
  getSettings: jest.fn(),
  getToken: jest.fn(),
}));

jest.mock("../cache", () => ({
  cacheApiResponse: jest.fn(),
}));

jest.mock("../log", () => ({
  debug: jest.fn(),
  info: jest.fn(),
}));

// Mock global fetch
global.fetch = jest.fn();

describe("sync", () => {
  const mockHost = "example.com";
  const mockBaseUrl = "https://example.com";
  const mockToken = "test-token";

  beforeEach(() => {
    jest.clearAllMocks();
    (outbox.getToken as jest.Mock).mockResolvedValue(mockToken);
    (outbox.getSettings as jest.Mock).mockResolvedValue({
      limitConversations: 10,
      rps: 10,
    });
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  });

  describe("fullSync", () => {
    it("should fetch conversations and cache them", async () => {
      // Mock fetch responses
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [
            { id: "1", title: "Chat 1", updated_at: 1000 },
            { id: "2", title: "Chat 2", updated_at: 2000 },
          ],
        }) // List page 1
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [],
        }) // List page 2 (empty, stops loop)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ chat: { messages: [{}, {}] } }),
        }) // Chat 1 details
        .mockResolvedValueOnce({
          ok: true,
          json: async () => ({ chat: { messages: [{}] } }),
        }); // Chat 2 details

      const result = await fullSync(mockBaseUrl);

      expect(result.conversations).toBe(2);
      expect(result.messages).toBe(3);
      expect(outbox.getToken).toHaveBeenCalledWith(mockHost);
      expect(cache.cacheApiResponse).toHaveBeenCalledTimes(2);
      expect(AsyncStorage.setItem).toHaveBeenCalledWith(
        expect.stringContaining("sync:done"),
        expect.any(String)
      );
    });

    it("should handle pagination correctly", async () => {
      (outbox.getSettings as jest.Mock).mockResolvedValue({
        limitConversations: 5, // Small limit
        rps: 100,
      });

      // Page 1: 3 items
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [
            { id: "1", title: "1" },
            { id: "2", title: "2" },
            { id: "3", title: "3" },
          ],
        })
        // Page 2: 3 items (total 6, should stop at 5)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [
            { id: "4", title: "4" },
            { id: "5", title: "5" },
            { id: "6", title: "6" },
          ],
        })
        // Chat details mocks (need 5)
        .mockResolvedValue({ ok: true, json: async () => ({}) });

      const result = await fullSync(mockBaseUrl);
      expect(result.conversations).toBe(5);
    });

    it("should stop if token is missing", async () => {
      (outbox.getToken as jest.Mock).mockResolvedValue(null);
      await expect(fullSync(mockBaseUrl)).rejects.toThrow("No auth token captured yet");
    });
  });

  describe("incrementalSync", () => {
    it("should only fetch new conversations", async () => {
      // Set last sync time
      const lastSync = Date.now() - 10000;
      (AsyncStorage.getItem as jest.Mock).mockImplementation((key) => {
        if (key.includes("sync:lastTime")) return String(lastSync);
        return null;
      });

      // Mock responses:
      // Item 1: New (updated after lastSync)
      // Item 2: Old (updated before lastSync) -> Should stop loop
      (global.fetch as jest.Mock)
        .mockResolvedValueOnce({
          ok: true,
          json: async () => [
            { id: "new", updated_at: lastSync + 5000 },
            { id: "old", updated_at: lastSync - 5000 },
          ],
        })
        .mockResolvedValueOnce({ ok: true, json: async () => ({ chat: { messages: [] } }) }); // Detail for "new"

      const result = await incrementalSync(mockBaseUrl);
      expect(result?.conversations).toBe(1);
      expect(cache.cacheApiResponse).toHaveBeenCalledTimes(1);
    });
  });

  describe("maybeFullSync", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it("should wait for token if not present", async () => {
      (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null); // Not done
      (outbox.getToken as jest.Mock)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce("delayed-token");

      // Setup fetch for fullSync
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => [], // Empty list
      });

      const promise = maybeFullSync(mockBaseUrl);

      // Fast-forward time to trigger retries
      await jest.advanceTimersByTimeAsync(1000);

      const result = await promise;
      expect(result).not.toBeNull();
      expect(outbox.getToken).toHaveBeenCalledTimes(4);
    });
  });
});
