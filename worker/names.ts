// One account per name. Names are compared by nameKey (src/net/scores.ts),
// kept in the accounts database's "nameKey" column, unique (migration 0002):
// two accounts cannot end up with the same one, even at the same moment.

import { UNNAMED, nameKey, otherNames } from '../src/net/scores';

/** The names of the accounts, for one request. */
export class Names {
  private keyed?: Promise<void>;

  constructor(
    private readonly db: D1Database,
    /** An account renamed here (not through Better Auth): for the boards. */
    private readonly renamed: (id: string, name: string) => Promise<void>,
  ) {}

  /** Whether an account other than `self` has this name, or one that compares the same. The placeholder is nobody's to take. */
  async taken(name: string, self?: string): Promise<boolean> {
    const key = nameKey(name);
    if (key === nameKey(UNNAMED)) return true;
    const row = await this.db.prepare('SELECT id FROM "user" WHERE "nameKey" = ?').bind(key).first<{ id: string }>();
    return !!row && row.id !== self;
  }

  /** `name` if it is free, otherwise the first of its other names that is; null if none is. */
  async free(name: string, self?: string): Promise<string | null> {
    if (!(await this.taken(name, self))) return name;
    for (const other of otherNames(name)) if (!(await this.taken(other, self))) return other;
    return null;
  }

  /** The account lets its name go: the one it is being linked to takes it, and it is deleted right after. */
  async release(id: string): Promise<void> {
    await this.db.prepare('UPDATE "user" SET "nameKey" = NULL WHERE id = ?').bind(id).run();
  }

  /** Before any name is checked, once per request: the accounts named before names were compared get their key. */
  ready(): Promise<void> {
    return (this.keyed ??= this.keyOld());
  }

  /**
   * The accounts named before there were keys get theirs. If two had the same
   * name, the older one keeps it and the other gets a number, on the boards too.
   */
  private async keyOld(): Promise<void> {
    const { results } = await this.db
      .prepare('SELECT id, name FROM "user" WHERE "nameKey" IS NULL AND name <> ? ORDER BY "createdAt"')
      .bind(UNNAMED)
      .all<{ id: string; name: string }>();
    for (const { id, name } of results) {
      const free = await this.free(name, id);
      if (!free) continue;
      await this.db.prepare('UPDATE "user" SET name = ?, "nameKey" = ? WHERE id = ?').bind(free, nameKey(free), id).run();
      if (free !== name) await this.renamed(id, free);
    }
  }
}
