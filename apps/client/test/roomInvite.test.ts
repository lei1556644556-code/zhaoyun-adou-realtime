import { describe, expect, it } from "vitest";
import { createRoomInviteUrl, normalizeRoomCode, removeRoomInviteFromUrl } from "../src/app/roomInvite";

describe("room invitation links", () => {
  it("normalizes valid room codes and rejects malformed values", () => {
    expect(normalizeRoomCode(" ab12cd ")).toBe("AB12CD");
    expect(normalizeRoomCode("ABC12")).toBeNull();
    expect(normalizeRoomCode("ABC-12")).toBeNull();
  });

  it("creates a clean room-specific link instead of copying unrelated URL state", () => {
    expect(createRoomInviteUrl("https://example.com/game/?deploy=old#debug", "ab12cd"))
      .toBe("https://example.com/game/?room=AB12CD");
  });

  it("consumes only the room parameter after auto-joining", () => {
    expect(removeRoomInviteFromUrl("https://example.com/game/?room=AB12CD&lang=zh#top"))
      .toBe("https://example.com/game/?lang=zh#top");
  });
});
