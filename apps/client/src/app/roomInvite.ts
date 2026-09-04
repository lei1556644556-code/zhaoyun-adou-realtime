const ROOM_CODE_PATTERN = /^[A-Z0-9]{6}$/;

export function normalizeRoomCode(value: string | null | undefined) {
  const normalized = value?.trim().toUpperCase() ?? "";
  return ROOM_CODE_PATTERN.test(normalized) ? normalized : null;
}

export function createRoomInviteUrl(currentHref: string, roomCode: string) {
  const normalized = normalizeRoomCode(roomCode);
  if (!normalized) throw new Error("房间号无效");
  const url = new URL(currentHref);
  url.search = "";
  url.hash = "";
  url.searchParams.set("room", normalized);
  return url.toString();
}

export function removeRoomInviteFromUrl(currentHref: string) {
  const url = new URL(currentHref);
  url.searchParams.delete("room");
  return url.toString();
}
