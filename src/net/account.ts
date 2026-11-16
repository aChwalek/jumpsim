// The player's account, from the game's side (Better Auth, see worker/auth.ts).
// Nobody has to sign in: an anonymous account is made the first time one is
// needed (a score sent, a name given), and signing in with Google later keeps
// it, scores and all, on every device. Without a connection (or without
// `npm run dev:signal` in development) there is no account, and the game
// goes on without.

import { createAuthClient } from 'better-auth/client';
import { anonymousClient } from 'better-auth/client/plugins';
import { NAME_TAKEN } from './scores';

const client = createAuthClient({ basePath: '/api/auth', plugins: [anonymousClient()] });

export interface Account {
  id: string;
  name: string;
  /** Made by the game, not signed in: it goes with this browser's cookies. */
  anonymous: boolean;
}

interface SessionUser {
  id: string;
  name: string;
  isAnonymous?: boolean | null;
}

const toAccount = (user: SessionUser): Account => ({ id: user.id, name: user.name, anonymous: !!user.isAnonymous });

/** The account this browser is signed in with; null if none yet, or if the server cannot be reached. */
export async function loadAccount(): Promise<Account | null> {
  try {
    const { data } = await client.getSession();
    return data ? toAccount(data.user as SessionUser) : null;
  } catch {
    return null;
  }
}

/**
 * The account, made anonymous under `name` if there is none yet; null if the
 * server cannot be reached. If another account has that name, it gets a
 * number ("Bob 2"): the account says which.
 */
export async function ensureAccount(name: string): Promise<Account | null> {
  const have = await loadAccount();
  if (have) return have;
  try {
    const { data, error } = await client.signIn.anonymous();
    if (error || !data) return null;
    const made = toAccount(data.user as SessionUser);
    const named = await renameAccount(name);
    return named.ok ? { ...made, name: named.name } : made;
  } catch {
    return null;
  }
}

/**
 * How a new name went: the name the account now has (a name the game made up
 * can come back with another number), or why not: another account has it, or
 * it did not go through (offline).
 */
export type Renamed = { ok: true; name: string } | { ok: false; taken: boolean };

/** The account's new name, if no other account has it: the boards take it at once. */
export async function renameAccount(name: string): Promise<Renamed> {
  try {
    const { error } = await client.updateUser({ name });
    if (error) return { ok: false, taken: error.code === NAME_TAKEN };
    const now = await loadAccount();
    return now ? { ok: true, name: now.name } : { ok: false, taken: false };
  } catch {
    return { ok: false, taken: false };
  }
}

/**
 * Off to Google, and back to this page signed in. An anonymous account is
 * made first if need be, so that the name chosen goes along, then linked: its
 * scores go to the Google account.
 */
export async function signInWithGoogle(name: string): Promise<void> {
  await ensureAccount(name);
  await client.signIn.social({ provider: 'google', callbackURL: location.href });
}

/** Signed out: the next score is sent from a new anonymous account. */
export async function signOut(): Promise<void> {
  try {
    await client.signOut();
  } catch {
    // Offline: the cookie stays until next time.
  }
}

/** Whether signing in with Google is offered (the server has its keys). */
export async function googleOffered(): Promise<boolean> {
  try {
    const response = await fetch('/api/providers', { cache: 'no-store' });
    return response.ok && ((await response.json()) as { google?: unknown }).google === true;
  } catch {
    return false;
  }
}
