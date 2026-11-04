import { describe, expect, it } from "vitest";
import { suggestColumnSet } from "../folders/columnSetSuggestion";

// Fixture vocabulary only. The production vocabulary needs guide clarification.
const extensions = { photos: ["jpg", "png"], music: ["mp3"], documents: ["pdf"] };
describe("explicit column set suggestion", () => {
  it("5of8photos=>photos", () => {
    expect(suggestColumnSet(["1.jpg", "2.JPG", "3.png", "4.jpg", "5.jpg", "6.txt", "7", "8.bin"], extensions)).toBe("photos");
  });
  it("4of8=>general", () => {
    expect(suggestColumnSet(["1.jpg", "2.jpg", "3.jpg", "4.jpg", "5.txt", "6.txt", "7.txt", "8.txt"], extensions)).toBe("general");
  });
  it("4of4=>generalminimum5", () => {
    expect(suggestColumnSet(["1.jpg", "2.jpg", "3.jpg", "4.jpg"], extensions)).toBe("general");
  });
  it("does not infer from a dotfile or an extensionless filename", () => {
    expect(suggestColumnSet([".jpg", "1", "2", "3", "4"], extensions)).toBe("general");
  });
  it("requires a disjoint trusted vocabulary", () => {
    expect(() => suggestColumnSet([], { ...extensions, music: ["jpg"] })).toThrow("folder_custom.invalid");
  });
});
