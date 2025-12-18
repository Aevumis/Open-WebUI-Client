import { getErrorMessage, tryCatch } from "../error-utils";

describe("error-utils", () => {
  describe("getErrorMessage", () => {
    it("should extract message from Error object", () => {
      expect(getErrorMessage(new Error("test error"))).toBe("test error");
    });

    it("should return string as is", () => {
      expect(getErrorMessage("test error string")).toBe("test error string");
    });

    it("should convert other types to string", () => {
      expect(getErrorMessage(123)).toBe("123");
      expect(getErrorMessage({ foo: "bar" })).toBe("[object Object]");
    });
  });

  describe("tryCatch", () => {
    it("should return result on success", async () => {
      const fn = jest.fn().mockResolvedValue("success");
      const result = await tryCatch(fn, "fallback");
      expect(result).toBe("success");
      expect(fn).toHaveBeenCalled();
    });

    it("should return fallback on error", async () => {
      const fn = jest.fn().mockRejectedValue(new Error("fail"));
      const onError = jest.fn();
      const result = await tryCatch(fn, "fallback", onError);
      expect(result).toBe("fallback");
      expect(onError).toHaveBeenCalled();
    });
  });
});
