import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createMatch } from "@adou/shared";
import { repositoryRoot } from "../helpers/contracts";

describe("release contract gates", () => {
  it("publishes the snapshot schema version required by docs/contracts", () => {
    const snapshot = createMatch("RELEASE", 109) as unknown as Record<string, unknown>;
    expect(snapshot.version, "MatchSnapshot must carry an explicit schema version").toBeTypeOf("number");
  });

  it("does not duplicate hero-pair rules inside the practice bot", () => {
    const source = readFileSync(path.join(repositoryRoot, "apps/client/src/game/PracticeEngine.ts"), "utf8");
    expect(source, "PracticeEngine must consume HERO_PAIRS instead of maintaining a second hero list")
      .not.toMatch(/const\s+heroPairs\s*=\s*new\s+Set/);
  });
});
