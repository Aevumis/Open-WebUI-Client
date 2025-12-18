import {
  enqueue,
  drain,
  count,
  getSettings,
  setSettings,
  listOutbox,
  removeOutboxItems,
} from "../outbox";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { STORAGE_KEYS } from "../storage-keys";

// Mock other dependencies
jest.mock("../url-utils", () => ({
  safeGetHost: (url: string) => {
    try {
      return new URL(url).host;
    } catch {
      return null;
    }
  },
}));

// Mock mutex to avoid complex lock logic in tests
jest.mock("../mutex", () => ({
  withLock: jest.fn().mockImplementation((key, timeout, fn) => fn()),
  acquireLock: jest.fn().mockImplementation(() => Promise.resolve(() => {})),
}));

describe("outbox", () => {
  const host = "example.com";
  const baseUrl = `https://${host}`;

  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
    (global.fetch as any) = jest.fn();
  });

  describe("settings", () => {
    it("should return default settings if none stored", async () => {
      const settings = await getSettings(host);
      expect(settings.rps).toBe(5);
      expect(settings.limitConversations).toBe(30);
    });

    it("should store and retrieve settings", async () => {
      await setSettings(host, { rps: 10, limitConversations: 100, fullSyncOnLoad: true });
      const settings = await getSettings(host);
      expect(settings.rps).toBe(10);
      expect(settings.limitConversations).toBe(100);
    });
  });

  describe("queue management", () => {
    it("should enqueue and count items", async () => {
      await enqueue(host, { id: "1", chatId: "c1", body: { messages: [] } });
      await enqueue(host, { id: "2", chatId: "c2", body: { messages: [] } });

      expect(await count(host)).toBe(2);
      const list = await listOutbox(host);
      expect(list.length).toBe(2);
      expect(list[0]?.id).toBe("1");
    });

    it("should remove items", async () => {
      await enqueue(host, { id: "1", chatId: "c1", body: { messages: [] } });
      await enqueue(host, { id: "2", chatId: "c2", body: { messages: [] } });

      await removeOutboxItems(host, ["1"]);
      expect(await count(host)).toBe(1);
      const list = await listOutbox(host);
      expect(list[0]?.id).toBe("2");
    });
  });

  describe("drain", () => {
    it("should send items and remove them on success", async () => {
      await enqueue(host, {
        id: "1",
        chatId: "c1",
        body: { messages: [{ role: "user", content: "hi" }] },
      });
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        status: 200,
      });
      await AsyncStorage.setItem(STORAGE_KEYS.authToken(host), "test-token");

      const result = await drain(baseUrl);
      expect(result.sent).toBe(1);
      expect(result.remaining).toBe(0);
    });

    it("should increment tries on failure", async () => {
      await enqueue(host, {
        id: "1",
        chatId: "c1",
        body: { messages: [{ role: "user", content: "hi" }] },
      });
      (global.fetch as jest.Mock).mockResolvedValue({
        ok: false,
        status: 500,
      });
      await AsyncStorage.setItem(STORAGE_KEYS.authToken(host), "test-token");

      const result = await drain(baseUrl);
      expect(result.sent).toBe(0);
      expect(result.remaining).toBe(1);

      const list = await listOutbox(host);
      expect(list[0]?.tries).toBe(1);
      expect(list[0]?.lastError).toContain("500");
    });
  });
});
