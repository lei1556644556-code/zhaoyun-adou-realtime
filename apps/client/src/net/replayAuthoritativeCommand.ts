import {
  GAME_CONFIG, REALTIME_SYNC_CONFIG, cloneSnapshot, executeCommand,
  type AppliedCommandPayload, type MatchSnapshot,
} from "@adou/shared";
import { stepMatchBatch } from "./stepMatchBatch";

/**
 * Replays one server-accepted command while preserving the authoritative
 * command RNG/version even when the rendering client is a Tick ahead.
 */
export function replayAuthoritativeCommand(snapshot: MatchSnapshot, payload: AppliedCommandPayload) {
  const replay = cloneSnapshot(snapshot);
  const catchupTicks = payload.serverTick - replay.tick;
  // A heavily throttled/background tab should take a compressed resync instead
  // of blocking the UI thread with an unbounded synchronous catch-up loop.
  if (catchupTicks > REALTIME_SYNC_CONFIG.commandCatchupMaxTicks) return null;
  if (catchupTicks > 0) stepMatchBatch(replay, catchupTicks, 1000 / GAME_CONFIG.tickHz);
  const localStateVersion = replay.stateVersion;
  const localEventSequence = replay.eventSequence;
  replay.stateVersion = payload.serverStateVersionBefore;
  replay.eventSequence = payload.serverEventSequenceBefore;
  const result = executeCommand(replay, payload.slot, {
    commandId: payload.commandId,
    clientSeq: payload.clientSeq,
    expectedStateVersion: payload.serverStateVersionBefore,
    command: payload.command,
  });
  if (!result.ok || result.stateVersion !== payload.serverStateVersion) return null;

  const generatedEventCount = replay.eventSequence - payload.serverEventSequenceBefore;
  replay.stateVersion = Math.max(localStateVersion + 1, payload.serverStateVersion);
  replay.eventSequence = Math.max(replay.eventSequence, localEventSequence + generatedEventCount);
  return replay;
}
