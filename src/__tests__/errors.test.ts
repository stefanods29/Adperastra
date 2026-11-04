import { describe, expect, it } from "vitest";
import i18n from "../i18n";
import { errorCode, errorText } from "../services/errors";
import { extensionOf, fileUrl } from "../services/files";

describe("error codes", () => {
  it("reads the code from strings and errors", () => {
    expect(errorCode("files.not_found")).toBe("files.not_found");
    expect(errorCode(new Error("files.access_denied"))).toBe("files.access_denied");
    expect(errorCode(42)).toBe("");
  });

  it("translates known reasons and falls back to the area's message", async () => {
    await i18n.changeLanguage("en");
    expect(errorText(i18n.t, "files.not_found", "files")).toBe("This file no longer exists.");
    expect(errorText(i18n.t, "files.something_new", "files")).toBe("This file couldn't be opened.");
    expect(errorText(i18n.t, "ops.exists", "files")).toBe("This file couldn't be opened.");
  });
});

describe("file URLs", () => {
  it("uses the Windows form of the custom protocol", () => {
    expect(fileUrl("0123456789abcdef0123456789abcdef", "My photo #1.png")).toBe(
      "http://adpfile.localhost/0123456789abcdef0123456789abcdef/My%20photo%20%231.png",
    );
  });

  it("finds extensions like the Rust side", () => {
    expect(extensionOf("photo.JPG")).toBe("jpg");
    expect(extensionOf(".gitignore")).toBe("");
    expect(extensionOf("noext")).toBe("");
  });
});
