// Prints the SQL that makes Better Auth's tables in the accounts database
// (D1, binding ACCOUNTS), for the plugins and fields worker/auth.ts uses.
// 0001 is what it printed first:
//   node tools/accounts/schema.mjs > worker/migrations/0001_accounts.sql
// When they change, write what is new as the next file of worker/migrations
// (0002 adds "nameKey", with its unique index, by hand).
import { DatabaseSync } from 'node:sqlite';
import { getMigrations } from 'better-auth/db/migration';
import { anonymous } from 'better-auth/plugins/anonymous';

const { compileMigrations } = await getMigrations({
  database: new DatabaseSync(':memory:'),
  plugins: [anonymous()],
  user: { additionalFields: { nameKey: { type: 'string', required: false } } },
});
process.stdout.write(`${await compileMigrations()}\n`);
