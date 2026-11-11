// How the sim runs on this computer, as opposed to the jump: picture quality,
// sound, the mouse. Remembered from one visit to the next.

/** Picture quality: the highest pixel density drawn, as a multiple of CSS pixels. */
export const QUALITY_LEVELS = [
  { ratio: 1, label: 'Basse' },
  { ratio: 1.5, label: 'Moyenne' },
  { ratio: 2, label: 'Haute' },
  { ratio: 3, label: 'Max' },
] as const;

export const SENSITIVITY_MIN = 0.3;
export const SENSITIVITY_MAX = 3;

export interface Settings {
  /** Index in QUALITY_LEVELS. */
  quality: number;
  /** Lower the resolution by itself when the frame rate drops. */
  autoResolution: boolean;
  /** Frame rate and render scale in the corner. */
  showFps: boolean;
  sound: boolean;
  /** 0 to 1. */
  volume: number;
  /** Multiple of the base mouse speed. */
  mouseSensitivity: number;
  /** Mouse forward and stick up look down, as in a plane. */
  invertLook: boolean;
}

export function defaultSettings(): Settings {
  return {
    quality: 2,
    autoResolution: true,
    showFps: true,
    sound: true,
    volume: 1,
    mouseSensitivity: 1,
    invertLook: false,
  };
}

const STORE = 'settings';
const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Brings anything saved back to valid settings. */
export function validSettings(saved: unknown): Settings {
  const out = defaultSettings();
  const s = (saved ?? {}) as Partial<Record<keyof Settings, unknown>>;
  if (finite(s.quality)) out.quality = clamp(Math.round(s.quality), 0, QUALITY_LEVELS.length - 1);
  if (typeof s.autoResolution === 'boolean') out.autoResolution = s.autoResolution;
  if (typeof s.showFps === 'boolean') out.showFps = s.showFps;
  if (typeof s.sound === 'boolean') out.sound = s.sound;
  if (finite(s.volume)) out.volume = clamp(s.volume, 0, 1);
  if (finite(s.mouseSensitivity)) out.mouseSensitivity = clamp(s.mouseSensitivity, SENSITIVITY_MIN, SENSITIVITY_MAX);
  if (typeof s.invertLook === 'boolean') out.invertLook = s.invertLook;
  return out;
}

export function loadSettings(): Settings {
  try {
    const saved = localStorage.getItem(STORE);
    if (saved) return validSettings(JSON.parse(saved));
    // Quality and sound used to be kept on their own.
    const quality = localStorage.getItem('quality');
    return validSettings({
      quality: quality === null ? undefined : Number(quality),
      sound: localStorage.getItem('muted') !== '1',
    });
  } catch {
    return defaultSettings();
  }
}

export function saveSettings(settings: Settings): void {
  try {
    localStorage.setItem(STORE, JSON.stringify(settings));
  } catch {
    // Private browsing or storage full: not remembered.
  }
}
