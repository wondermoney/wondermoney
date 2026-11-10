import { Migration } from '@mikro-orm/migrations';

/**
 * Per-user preferences: `appuser` gains `preferences`, a JSON document holding the settings
 * that are not a fixed column (today `{ previewFeatures: boolean }`). Existing rows get `{}`,
 * which reads as every default. One additive column.
 */
export class Migration20261110223418 extends Migration {

  override name = 'Migration20261110223418';

  override up(): void | Promise<void> {
    this.addSql(`alter table "appuser" add "preferences" jsonb not null default '{}';`);
  }

  override down(): void | Promise<void> {
    this.addSql(`alter table "appuser" drop column "preferences";`);
  }

}
