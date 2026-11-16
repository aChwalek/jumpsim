import { describe, expect, it } from 'vitest';
import { shareLink, type ShareWays } from '../src/ui/share';

const data = { title: 'Lowpull', text: 'Viens sauter avec moi à Valbrise sur Lowpull', url: 'https://jump.lowpull.app/?room=saut-abc234' };

/** Ways that note what was done with the link; `refuse` names those that throw, and with what. */
function ways(offer: { share?: boolean; copy?: boolean } = {}, refuse: { share?: string; copy?: boolean } = {}) {
  const done: string[] = [];
  const w: ShareWays = {
    share: offer.share
      ? async (d) => {
          if (refuse.share) throw Object.assign(new Error('no'), { name: refuse.share });
          done.push(`share ${d.url}`);
        }
      : undefined,
    copy: offer.copy
      ? async (t) => {
          if (refuse.copy) throw new Error('no');
          done.push(`copy ${t}`);
        }
      : undefined,
    show: (t) => void done.push(`show ${t}`),
  };
  return { w, done };
}

describe('sharing a link', () => {
  it("goes through the device's sheet where there is one", async () => {
    const { w, done } = ways({ share: true, copy: true });
    expect(await shareLink(data, w)).toBe('shared');
    expect(done).toEqual([`share ${data.url}`]);
  });

  it('does nothing more when the sheet is closed without sending', async () => {
    const { w, done } = ways({ share: true, copy: true }, { share: 'AbortError' });
    expect(await shareLink(data, w)).toBe('cancelled');
    expect(done).toEqual([]);
  });

  it('copies the link when the sheet is refused or there is none, or one that cannot send it', async () => {
    const refused = ways({ share: true, copy: true }, { share: 'NotAllowedError' });
    expect(await shareLink(data, refused.w)).toBe('copied');
    expect(refused.done).toEqual([`copy ${data.url}`]);
    const none = ways({ copy: true });
    expect(await shareLink(data, none.w)).toBe('copied');
    const unable = ways({ share: true, copy: true });
    unable.w.canShare = () => false;
    expect(await shareLink(data, unable.w)).toBe('copied');
    expect(unable.done).toEqual([`copy ${data.url}`]);
  });

  it('shows the link when it can be neither sent nor copied', async () => {
    const { w, done } = ways({ share: true, copy: true }, { share: 'NotAllowedError', copy: true });
    expect(await shareLink(data, w)).toBe('shown');
    expect(done).toEqual([`show ${data.url}`]);
  });
});
