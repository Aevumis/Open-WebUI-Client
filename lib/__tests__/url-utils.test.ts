import { safeGetHost, safeParseUrl, isValidUrl } from "../url-utils";

describe("url-utils", () => {
  describe("safeGetHost", () => {
    it("should extract host from valid URL", () => {
      expect(safeGetHost("https://example.com/path")).toBe("example.com");
    });

    it("should return null for invalid URL", () => {
      expect(safeGetHost("not-a-url")).toBeNull();
    });

    it("should handle URLs with ports", () => {
      expect(safeGetHost("https://example.com:8080")).toBe("example.com:8080");
    });
  });

  describe("safeParseUrl", () => {
    it("should parse valid URL", () => {
      const u = safeParseUrl("https://example.com");
      expect(u).toBeInstanceOf(URL);
      expect(u?.hostname).toBe("example.com");
    });

    it("should return null for invalid URL", () => {
      expect(safeParseUrl("not-a-url")).toBeNull();
    });
  });

  describe("isValidUrl", () => {
    it("should return true for valid URLs", () => {
      expect(isValidUrl("https://example.com")).toBe(true);
    });

    it("should return false for invalid URLs", () => {
      expect(isValidUrl("not a url")).toBe(false);
    });
  });
});
