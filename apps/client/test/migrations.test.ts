import { describe, expect, it } from "vitest";

import initialMigration from "../../../supabase/migrations/20260902133000_player_accounts.sql?raw";
import progressMigration from "../../../supabase/migrations/20260903120000_account_progress_v2.sql?raw";
import progressRollback from "../../../supabase/rollback/20260903120000_account_progress_v2.down.sql?raw";

describe("Supabase account migrations", () => {
  it("enables account-bound RLS and gives anon no profile access", () => {
    expect(initialMigration).toMatch(/enable row level security/i);
    expect(initialMigration).toMatch(/using \(\(select auth\.uid\(\)\) = user_id\)/i);
    expect(initialMigration).toMatch(/with check \(\(select auth\.uid\(\)\) = user_id\)/i);
    expect(initialMigration).toMatch(/revoke all on table public\.zhaoyun_adou_profiles from anon/i);
  });

  it("uses an account-bound, revision-checked RPC for progress writes", () => {
    expect(progressMigration).toMatch(/p_account_id is distinct from v_user_id/i);
    expect(progressMigration).toMatch(/profiles\.progress_revision = p_expected_revision/i);
    expect(progressMigration).toMatch(/errcode = '40001'/i);
    expect(progressMigration).toMatch(/pg_column_size\(p_progress\) > 1048576/i);
    expect(progressMigration).toMatch(/coalesce\(jsonb_typeof\(p_progress -> 'version'\), 'missing'\) <> 'number'/i);
    expect(progressMigration).toMatch(/revoke insert, update, delete[\s\S]*from authenticated/i);
    expect(progressMigration).toMatch(/grant insert \(user_id, display_name, username_normalized\)/i);
    expect(progressMigration).toMatch(/force row level security/i);
    expect(progressMigration).toMatch(/extensions\.digest\(convert_to\('zhaoyun-adou:' \|\| username_normalized/i);
  });

  it("provides an explicit rollback to the v1 grants and insert policy", () => {
    expect(progressRollback).toMatch(/drop function if exists public\.zhaoyun_adou_save_progress/i);
    expect(progressRollback).toMatch(/drop column if exists progress_revision/i);
    expect(progressRollback).toMatch(/with check \(\(select auth\.uid\(\)\) = user_id\)/i);
    expect(progressRollback).toMatch(/grant select, insert, update/i);
  });
});
