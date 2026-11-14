// Prints the SQL that makes Better Auth's tables in the accounts database
// (D1, binding ACCOUNTS), for the plugins worker/auth.ts uses. Run it when
// they change, and keep what it prints as the next file of worker/migrations:
//   node tools/accounts/schema.mjs > worker/migrations/0001_accounts.sql
import { DatabaseSync } from 'node:sqlite';
import { getMigrations } from 'better-auth/db/migration';
import { anonymous } from 'better-auth/plugins/anonymous';

const { compileMigrations } = await getMigrations({ database: new DatabaseSync(':memory:'), plugins: [anonymous()] });
process.stdout.write(`${await compileMigrations()}\n`);
