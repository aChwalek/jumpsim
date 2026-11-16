// Sending a link to someone: through the device's own sheet where there is
// one (a phone, Safari, Windows), otherwise copied to paste anywhere, and if
// neither will (a gamepad press is not a gesture the browser trusts), shown
// to be copied by hand.

/** How it went: sent through the sheet, copied, shown, or the sheet closed without sending. */
export type Shared = 'shared' | 'copied' | 'shown' | 'cancelled';

export interface ShareData {
  title: string;
  text: string;
  url: string;
}

/** What the browser offers, as far as it does. */
export interface ShareWays {
  share?: (data: ShareData) => Promise<void>;
  canShare?: (data: ShareData) => boolean;
  copy?: (text: string) => Promise<void>;
  show: (text: string) => void;
}

export async function shareLink(data: ShareData, ways: ShareWays): Promise<Shared> {
  if (ways.share && (ways.canShare?.(data) ?? true)) {
    try {
      await ways.share(data);
      return 'shared';
    } catch (e) {
      // Closed by the user: nothing more to do. Refused (no gesture): on to copying.
      if ((e as { name?: unknown } | null)?.name === 'AbortError') return 'cancelled';
    }
  }
  if (ways.copy) {
    try {
      await ways.copy(data.url);
      return 'copied';
    } catch {
      // Not allowed here: shown instead.
    }
  }
  ways.show(data.url);
  return 'shown';
}

/** This browser's ways; `prompt` says what the link shown is. */
export function browserWays(prompt: string): ShareWays {
  const nav = navigator;
  return {
    share: typeof nav.share === 'function' ? (d) => nav.share(d) : undefined,
    canShare: typeof nav.canShare === 'function' ? (d) => nav.canShare(d) : undefined,
    copy: nav.clipboard ? (t) => nav.clipboard.writeText(t) : undefined,
    show: (t) => void window.prompt(prompt, t),
  };
}
