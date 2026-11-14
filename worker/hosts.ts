// Which addresses share the accounts' session: on its own, without the
// Workers types, so that the game's tests can check it.

/** Accounts live under this domain: one sign-in for the game and whatever else comes under it. */
export const ACCOUNTS_DOMAIN = 'lowpull.app';

/** lowpull.app and the apps right under it, not what is deeper (the branch previews, x.jump.lowpull.app). */
export const sharesAccounts = (host: string): boolean => host === ACCOUNTS_DOMAIN || /^[a-z0-9-]+\.lowpull\.app$/.test(host);
