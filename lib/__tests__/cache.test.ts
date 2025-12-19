import * as FileSystem from "expo-file-system/legacy";

jest.mock("expo-file-system/legacy", () => ({
  documentDirectory: "file://mock-directory/",
  makeDirectoryAsync: jest.fn().mockResolvedValue(undefined),
  readAsStringAsync: jest.fn().mockResolvedValue(""),
  writeAsStringAsync: jest.fn().mockResolvedValue(undefined),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
  getInfoAsync: jest.fn().mockResolvedValue({ exists: false }),
}));

import { cacheApiResponse, getCacheIndex, readCachedEntry, recalculateSize } from "../cache";
jest.mock("../url-utils", () => ({
  safeParseUrl: (url: string) => {
    try {
      return new URL(url);
    } catch {
      return null;
    }
  },
}));

describe("cache", () => {
  const host = "example.com";
  const mockId = "chat-123";
  const mockUrl = `https://${host}/api/v1/chats/${mockId}`;
  const mockEntry = {
    url: mockUrl,
    capturedAt: 1000,
    data: { id: mockId, title: "Test Chat" },
    title: "Test Chat",
  };

  beforeEach(() => {
    jest.clearAllMocks();
    (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValue(null);
  });

  describe("cacheApiResponse", () => {
    it("should write entry to file system and update index", async () => {
      (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({ exists: true, size: 100 });
      (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValue(JSON.stringify({}));

      await cacheApiResponse(host, mockEntry);

      expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith(
        expect.stringContaining(mockId),
        JSON.stringify(mockEntry)
      );
      // Index update
      expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith(
        expect.stringContaining("index.json"),
        expect.stringContaining(mockId)
      );
    });
  });

  describe("readCachedEntry", () => {
    it("should return cached entry if exists", async () => {
      (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValue(JSON.stringify(mockEntry));

      const entry = await readCachedEntry(host, mockId);
      expect(entry).toEqual(mockEntry);
    });

    it("should return null if entry does not exist", async () => {
      (FileSystem.readAsStringAsync as jest.Mock).mockRejectedValue(new Error("File not found"));

      const entry = await readCachedEntry(host, mockId);
      expect(entry).toBeNull();
    });
  });

  describe("getCacheIndex", () => {
    it("should return sorted index items", async () => {
      const mockIndex = {
        "host/id1": { key: "host/id1", lastAccess: 100 },
        "host/id2": { key: "host/id2", lastAccess: 200 },
      };
      (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValue(JSON.stringify(mockIndex));

      const index = await getCacheIndex();
      expect(index[0]!.key).toBe("host/id2");
      expect(index[1]!.key).toBe("host/id1");
    });
  });

  describe("recalculateSize", () => {
    it("should sum up sizes of existing files", async () => {
      const mockIndex = {
        "host/id1": { key: "host/id1", host: "host", id: "id1", size: 50 },
      };
      (FileSystem.readAsStringAsync as jest.Mock).mockResolvedValue(JSON.stringify(mockIndex));
      (FileSystem.getInfoAsync as jest.Mock).mockResolvedValue({ exists: true, size: 100 });

      const totalSize = await recalculateSize();
      expect(totalSize).toBe(100);
      // Index should be updated with new size
      expect(FileSystem.writeAsStringAsync).toHaveBeenCalledWith(
        expect.stringContaining("index.json"),
        expect.stringContaining('"size":100')
      );
    });
  });
});
