-- One account per name: what names are compared by (nameKey in src/net/scores.ts,
-- written by worker/auth.ts), unique. Empty for anonymous accounts not named
-- yet; the accounts named before this get theirs from the Worker (worker/names.ts).
alter table "user" add column "nameKey" text;

create unique index "user_nameKey_uidx" on "user" ("nameKey");
