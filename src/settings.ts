// How the sim runs on this computer, as opposed to the jump: picture quality,
// sound, the mouse, the language. Remembered from one visit to the next.

import { LANGS, browserLanguage, type Lang } from './i18n';

/** Picture quality: the highest pixel density drawn, as a multiple of CSS pixels. Named in T.setup.quality. */
export const QUALITY_LEVELS = [{ ratio: 1 }, { ratio: 1.5 }, { ratio: 2 }, { ratio: 3 }] as const;

export const SENSITIVITY_MIN = 0.3;
export const SENSITIVITY_MAX = 3;

export interface Settings {
  /** Index in QUALITY_LEVELS. */
  quality: number;
  /** Lower the resolution by itself when the frame rate drops. */
  autoResolution: boolean;
  /** Frame rate and render scale in the corner. */
  showFps: boolean;
  /** The keys for the moment down the side of the screen (K in flight). */
  showKeys: boolean;
  sound: boolean;
  /** 0 to 1. */
  volume: number;
  /** Multiple of the base mouse speed. */
  mouseSensitivity: number;
  /** Mouse forward and stick up look down, as in a plane. */
  invertLook: boolean;
  /**
   * On trial: in freefall ↑ ↓ ← → held swing the body round little by little
   * (flat → track → angle → head down → back → sitting; ← / → onto the back),
   * instead of going from one position to the next.
   */
  progressiveFly: boolean;
  /** The language on screen. */
  language: Lang;
  /** The name the others see in a room; empty until one is made up or chosen. */
  playerName: string;
}

export function defaultSettings(): Settings {
  return {
    quality: 2,
    autoResolution: true,
    showFps: true,
    showKeys: true,
    sound: true,
    volume: 1,
    mouseSensitivity: 1,
    invertLook: false,
    progressiveFly: false,
    language: browserLanguage(),
    playerName: '',
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
  if (typeof s.showKeys === 'boolean') out.showKeys = s.showKeys;
  if (typeof s.sound === 'boolean') out.sound = s.sound;
  if (finite(s.volume)) out.volume = clamp(s.volume, 0, 1);
  if (finite(s.mouseSensitivity)) out.mouseSensitivity = clamp(s.mouseSensitivity, SENSITIVITY_MIN, SENSITIVITY_MAX);
  if (typeof s.invertLook === 'boolean') out.invertLook = s.invertLook;
  if (typeof s.progressiveFly === 'boolean') out.progressiveFly = s.progressiveFly;
  if (LANGS.includes(s.language as Lang)) out.language = s.language as Lang;
  if (typeof s.playerName === 'string') out.playerName = s.playerName.replace(/\s+/g, ' ').trim().slice(0, 20);
  return out;
}

export function loadSettings(): Settings {
  try {
    const saved = localStorage.getItem(STORE);
    if (saved) return validSettings(JSON.parse(saved));
    // Quality, sound and the keys on screen used to be kept on their own.
    const quality = localStorage.getItem('quality');
    return validSettings({
      quality: quality === null ? undefined : Number(quality),
      sound: localStorage.getItem('muted') !== '1',
      showKeys: localStorage.getItem('keys') !== '0',
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
