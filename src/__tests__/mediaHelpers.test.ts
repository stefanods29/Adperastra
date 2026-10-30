import { describe, expect, it } from "vitest";
import { formatDuration, isVideo, srtToVtt, subtitleLabel, toVtt } from "../handlers/media/helpers";

describe("media helpers", () => {
  it("tells video from audio", () => {
    expect(isVideo({ mime: "video/mp4", ext: "mp4" })).toBe(true);
    expect(isVideo({ mime: "application/octet-stream", ext: "webm" })).toBe(true);
    expect(isVideo({ mime: "video/webm", ext: "weba" })).toBe(false);
    expect(isVideo({ mime: "audio/mpeg", ext: "mp3" })).toBe(false);
    expect(isVideo({ mime: "audio/mpeg", ext: "dat" })).toBe(false);
  });

  it("formats lengths", () => {
    expect(formatDuration(7.9)).toBe("0:07");
    expect(formatDuration(185)).toBe("3:05");
    expect(formatDuration(3723)).toBe("1:02:03");
    expect(formatDuration(-1)).toBe("0:00");
  });

  it("turns SubRip into WebVTT", () => {
    const srt = "\uFEFF1\r\n0:00:01,500 --> 00:00:04,000\r\nHello\r\n\r\n2\r\n00:01:02,000 --> 00:01:03,250\r\n<i>World</i>\r\n";
    expect(srtToVtt(srt)).toBe("WEBVTT\n\n1\n00:00:01.500 --> 00:00:04.000\nHello\n\n2\n00:01:02.000 --> 00:01:03.250\n<i>World</i>\n");
    expect(toVtt("a.VTT", "\uFEFFWEBVTT\n\nx")).toBe("WEBVTT\n\nx");
    expect(toVtt("a.srt", "1\n00:00:00,000 --> 00:00:01,000\nHi")).toContain("00:00:00.000");
  });

  it("lists subtitle files by what follows the video's name", () => {
    expect(subtitleLabel("Holidays.mp4", "Holidays.en.srt")).toBe("en.srt");
    expect(subtitleLabel("Holidays.mp4", "holidays.srt")).toBe("holidays.srt");
    expect(subtitleLabel("Holidays.mp4", "Other.srt")).toBe("Other.srt");
  });
});
