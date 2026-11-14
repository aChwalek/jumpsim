import { betterAuth } from 'better-auth';
import { anonymous } from 'better-auth/plugins/anonymous';
import { cleanName, madeUpName } from '../src/net/scores';
import { ACCOUNTS_DOMAIN, sharesAccounts } from './hosts';

/** Secrets (`wrangler secret put`, or .dev.vars when run locally). Without Google's, signing in with Google is not offered. */
export interface AuthSecrets {
  BETTER_AUTH_SECRET?: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  /** Where the browser sees the site when it is not the request's own address: Vite's in development. */
  AUTH_ORIGIN?: string;
}

/** How long a session lasts, s: about the longest browsers keep a cookie. An anonymous account is lost with it. */
const SESSION_SECONDS = 400 * 24 * 3600;
/** An account whose first session came this soon after it was made was made by that sign-in, ms. */
const NEW_ACCOUNT_MS = 5_000;

export const googleOffered = (env: AuthSecrets): boolean => !!(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET);

/**
 * Better Auth, under /api/auth, for one request: made again for each one, as
 * D1 is only there inside a request. Anonymous accounts first, made the first
 * time a score is sent; Google later links one to a real account, and the
 * scores go with it. The accounts are in their own database (ACCOUNTS),
 * apart from the game's: another app under lowpull.app can share them.
 */
export function createAuth(env: Env & AuthSecrets, request: Request) {
  const url = new URL(request.url);
  const origin = env.AUTH_ORIGIN ?? url.origin;
  // The apps themselves (lowpull.app, jump.lowpull.app) share one session.
  // Branch previews (x.jump.lowpull.app) and any other address keep a cookie
  // of their own, under another name: they have their own accounts database,
  // and must not overwrite the live site's session, nor read it.
  const shared = sharesAccounts(new URL(origin).hostname);
  const leaderboard = (): DurableObjectStub<import('./index').Leaderboard> => env.LEADERBOARD.get(env.LEADERBOARD.idFromName('accuracy'));
  return betterAuth({
    database: env.ACCOUNTS,
    secret: env.BETTER_AUTH_SECRET,
    baseURL: origin,
    basePath: '/api/auth',
    trustedOrigins: [origin],
    session: { expiresIn: SESSION_SECONDS, updateAge: 24 * 3600 },    socialProviders: googleOffered(env)
      ? {
          google: {
            clientId: env.GOOGLE_CLIENT_ID!,
            clientSecret: env.GOOGLE_CLIENT_SECRET!,
            // The first name only: a board is public.
            mapProfileToUser: (profile) => ({ name: profile.given_name || profile.name }),
          },
        }
      : {},
    plugins: [
      anonymous({
        // Named by the browser right after, in its language.
        generateName: () => 'Skydiver',
        onLinkAccount: async ({ anonymousUser, newUser, ctx }) => {
          let name = newUser.user.name;
          // An account made by this very sign-in (with its session) keeps the name chosen meanwhile, not the one Google has.
          const fresh = Math.abs(new Date(newUser.session.createdAt).getTime() - new Date(newUser.user.createdAt).getTime()) < NEW_ACCOUNT_MS;
          if (fresh && !madeUpName(anonymousUser.user.name)) {
            name = anonymousUser.user.name;
            await ctx.context.internalAdapter.updateUser(newUser.user.id, { name });
          }
          await leaderboard().moveScores(anonymousUser.user.id, newUser.user.id, name);
        },
      }),
    ],
    databaseHooks: {
      user: {
        create: {
          before: async (user) => ({ data: { ...user, name: cleanName(user.name ?? '') || 'Skydiver' } }),
        },
        update: {
          before: async (data) => {
            if (typeof data.name !== 'string') return;
            const name = cleanName(data.name);
            return name ? { data: { ...data, name } } : false;
          },
          // The boards show the name of the account, whatever it was when the score was sent.
          after: async (user) => {
            await leaderboard().rename(user.id, user.name);
          },
        },
      },
    },
    advanced: {
      ...(shared ? { crossSubDomainCookies: { enabled: true, domain: ACCOUNTS_DOMAIN } } : { cookiePrefix: 'lowpull-own' }),
      // Who is asking, for Better Auth's rate limits: Cloudflare says.
      ipAddress: { ipAddressHeaders: ['cf-connecting-ip'] },
    },
  });
}

/** The account a request comes from, if it has a session. */
export async function sessionUser(env: Env & AuthSecrets, request: Request): Promise<{ id: string; name: string } | null> {
  const session = await createAuth(env, request).api.getSession({ headers: request.headers });
  return session ? { id: session.user.id, name: session.user.name } : null;
}
