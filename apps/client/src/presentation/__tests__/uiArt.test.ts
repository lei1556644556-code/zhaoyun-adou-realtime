import { describe, it, expect } from "vitest";
import { statSync } from "node:fs";
import { PROPS } from "@adou/shared";
import { propIcon, uiAssetPath, uiIcon } from "../uiArt";
import assets from "../assets/ui-production.json";

describe("complete production UI resources", () => {
  it("covers every configured prop without duplicating gameplay data", () => {
    for (const prop of PROPS) {
      expect(assets).toHaveProperty(`prop-${prop.id}`);
      expect(propIcon(prop.id)).toContain(uiAssetPath(`prop-${prop.id}`));
      expect(propIcon(prop.id)).toContain('alt=""');
    }
  });
  it("keeps all framed panels, buttons and currency assets within budget", () => {
    expect(Object.keys(assets)).toHaveLength(41);
    for (const [key, asset] of Object.entries(assets)) {
      expect(asset.path).toBe(uiAssetPath(key));
      expect(statSync(new URL(`../../../public/${asset.path}`, import.meta.url)).size).toBe(asset.bytes);
      expect(asset.alpha).toBe(true);
    }
    expect(Object.values(assets).reduce((sum, asset) => sum + asset.bytes, 0)).toBeLessThan(850_000);
  });
  it("uses scalable decorative navigation symbols and project-relative asset URLs", () => {
    for(const key of ["sword", "crossed", "gate", "chest", "flag", "shield"] as const) expect(uiIcon(key)).toContain('aria-hidden="true"');
    expect(uiAssetPath("gold")).not.toMatch(/^\//);
  });
});
