// Moving around the menus with the keyboard or a gamepad as well as the
// mouse. One element of the screen shown has the focus at a time: the arrows,
// the D-pad or the left stick move it to the nearest element that way, except
// that left and right change the setting of a row that has some. Enter / A
// takes the focused element, Escape / B goes back.

export type Dir = 'up' | 'down' | 'left' | 'right';

export interface NavItem {
  /** Left and right on a row with a setting. `big`: Shift held, a bigger step. */
  adjust?: (step: -1 | 1, big: boolean) => void;
  /** Enter, Space or A. A button is clicked if this is not given. */
  activate?: () => void;
  /** Not reachable for now, shown dimmed. */
  disabled?: () => boolean;
}

export interface NavCommands {
  back(): void;
  /** Start on the gamepad. */
  start(): void;
  /** LB / RB, or Tab: the category before or after. */
  tab(step: -1 | 1): void;
  /** X and Y on the gamepad. */
  shortcut(button: 'x' | 'y'): void;
}

/** Standard gamepad mapping. */
const PAD = { a: 0, b: 1, x: 2, y: 3, lb: 4, rb: 5, start: 9, up: 12, down: 13, left: 14, right: 15 } as const;
const STICK = 0.5;
/** Holding a direction: first repeat after, then every, s. */
const REPEAT_DELAY = 0.38;
const REPEAT_EVERY = 0.085;

const VECTORS: Record<Dir, [number, number]> = { up: [0, -1], down: [0, 1], left: [-1, 0], right: [1, 0] };

type Input = Dir | 'a' | 'b' | 'x' | 'y' | 'lb' | 'rb' | 'start';

export class Nav {
  /** A gamepad was used last: the menus show its buttons in the hints. */
  padInUse = false;
  onPadChange: (padInUse: boolean) => void = () => {};

  private screen: HTMLElement | null = null;
  private focused: HTMLElement | null = null;
  private readonly items = new WeakMap<HTMLElement, NavItem>();
  /** Inputs down at the last poll, and when each repeats next. */
  private readonly down = new Map<Input, number>();
  /** Held when the menu opened: ignored until let go. */
  private readonly latched = new Set<Input>();
  private swallow = true;

  constructor(
    private readonly root: HTMLElement,
    private readonly commands: NavCommands,
    private readonly isOpen: () => boolean,
  ) {
    root.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse' && this.padInUse) this.setPad(false);
      // Not while dragging a slider: it would lose the browser's focus.
      if (e.buttons) return;
      const item = this.itemAt(e.target);
      if (item && item !== this.focused) this.focus(item, false);
    });
    // A click on a slider or a button gives it the browser's focus: the row follows.
    root.addEventListener('focusin', (e) => {
      const item = this.itemAt(e.target);
      if (item && item !== this.focused) this.focus(item, false);
    });
    window.addEventListener('keydown', (e) => this.key(e));
    // Space activates on key up in browsers: it is handled on key down here.
    window.addEventListener('keyup', (e) => {
      if (this.isOpen() && e.code === 'Space') e.preventDefault();
    });
  }

  /** Makes an element reachable, with what left, right and Enter do on it. */
  add<T extends HTMLElement>(el: T, item: NavItem = {}): T {
    el.dataset.nav = '';
    if (!(el instanceof HTMLButtonElement)) el.tabIndex = -1;
    this.items.set(el, item);
    return el;
  }

  /**
   * Shows a screen: the focus goes to `focus`, or to its first element. The
   * focus can then go anywhere visible in the menu, such as the corner buttons.
   */
  setScreen(screen: HTMLElement, focus?: HTMLElement | null): void {
    this.screen = screen;
    const first = focus && this.reachable(focus) ? focus : this.candidates(screen)[0];
    this.focused?.classList.remove('focus');
    this.focused = null;
    if (first) this.focus(first, true);
  }

  get current(): HTMLElement | null {
    return this.focused;
  }

  focus(el: HTMLElement, scroll: boolean): void {
    this.focused?.classList.remove('focus');
    this.focused = el;
    el.classList.add('focus');
    if (document.activeElement !== el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
    if (scroll) el.scrollIntoView({ block: 'nearest' });
  }

  /** Dims what cannot be reached right now; moves the focus off it. */
  refresh(): void {
    for (const el of this.root.querySelectorAll<HTMLElement>('[data-nav]')) {
      el.classList.toggle('disabled', !!this.items.get(el)?.disabled?.());
    }
    if (this.focused && this.root.contains(this.focused) && !this.reachable(this.focused)) {
      const next = this.nearest(this.focused, 'down') ?? this.nearest(this.focused, 'up');
      if (next) this.focus(next, true);
    }
  }

  /** Ignores whatever is held on the gamepad until it is let go: call when the menu opens. */
  holdUntilReleased(): void {
    this.swallow = true;
  }

  /** Reads the gamepad. Call every frame, open or not, to keep its state. */
  poll(now = performance.now() / 1000): void {
    const pad = navigator.getGamepads?.().find((g) => g?.connected && g.mapping === 'standard');
    const pressed = new Set<Input>();
    if (pad) {
      const b = (i: number): boolean => pad.buttons[i]?.pressed ?? false;
      const x = pad.axes[0] ?? 0;
      const y = pad.axes[1] ?? 0;
      if (b(PAD.up) || y < -STICK) pressed.add('up');
      if (b(PAD.down) || y > STICK) pressed.add('down');
      if (b(PAD.left) || x < -STICK) pressed.add('left');
      if (b(PAD.right) || x > STICK) pressed.add('right');
      for (const name of ['a', 'b', 'x', 'y', 'lb', 'rb', 'start'] as const) if (b(PAD[name])) pressed.add(name);
    }
    if (this.swallow || !this.isOpen()) {
      this.swallow = false;
      this.latched.clear();
      for (const input of pressed) this.latched.add(input);
      this.down.clear();
      return;
    }
    for (const input of [...this.latched]) if (!pressed.has(input)) this.latched.delete(input);
    for (const input of [...this.down.keys()]) if (!pressed.has(input)) this.down.delete(input);
    for (const input of pressed) {
      if (this.latched.has(input)) continue;
      const due = this.down.get(input);
      if (due === undefined) {
        this.down.set(input, now + REPEAT_DELAY);
        this.setPad(true);
        this.press(input, false);
      } else if (isDir(input) && now >= due) {
        this.down.set(input, now + REPEAT_EVERY);
        this.press(input, false);
      }
      // The menu may have closed on that press.
      if (!this.isOpen()) return;
    }
  }

  private setPad(inUse: boolean): void {
    if (this.padInUse === inUse) return;
    this.padInUse = inUse;
    this.onPadChange(inUse);
  }

  private key(e: KeyboardEvent): void {
    if (!this.isOpen() || e.metaKey || e.ctrlKey || e.altKey) return;
    const input = KEYS[e.code];
    if (!input) return;
    e.preventDefault();
    if (this.padInUse) this.setPad(false);
    if (e.code === 'Tab') return this.commands.tab(e.shiftKey ? -1 : 1);
    // Held arrows repeat, the rest acts once.
    if (e.repeat && !isDir(input)) return;
    this.press(input, e.shiftKey);
  }

  private press(input: Input, big: boolean): void {
    const item = this.focused && this.items.get(this.focused);
    switch (input) {
      case 'left':
      case 'right':
        if (item?.adjust && this.reachable(this.focused!)) {
          item.adjust(input === 'left' ? -1 : 1, big);
          return;
        }
        this.move(input);
        return;
      case 'up':
      case 'down':
        this.move(input);
        return;
      case 'a':
        if (!this.focused || !this.reachable(this.focused)) return;
        if (item?.activate) item.activate();
        else this.focused.click();
        return;
      case 'b':
        this.commands.back();
        return;
      case 'lb':
      case 'rb':
        this.commands.tab(input === 'lb' ? -1 : 1);
        return;
      case 'x':
      case 'y':
        this.commands.shortcut(input);
        return;
      case 'start':
        this.commands.start();
        return;
    }
  }

  private move(dir: Dir): void {
    if (!this.focused || !this.reachable(this.focused)) {
      const first = this.candidates(this.screen ?? this.root)[0];
      if (first) this.focus(first, true);
      return;
    }
    const next = this.nearest(this.focused, dir);
    if (next) this.focus(next, true);
  }

  /** The nearest reachable element from `from` in a direction, if any. */
  private nearest(from: HTMLElement, dir: Dir): HTMLElement | null {
    const [dx, dy] = VECTORS[dir];
    const a = from.getBoundingClientRect();
    let best: HTMLElement | null = null;
    let bestScore = Infinity;
    for (const el of this.candidates()) {
      if (el === from) continue;
      const b = el.getBoundingClientRect();
      // Gap between the two boxes along the direction, and how far off to the side.
      const along = dx ? (dx > 0 ? b.left - a.right : a.left - b.right) : dy > 0 ? b.top - a.bottom : a.top - b.bottom;
      const centreAlong = dx ? (b.left + b.right - a.left - a.right) * 0.5 * dx : (b.top + b.bottom - a.top - a.bottom) * 0.5 * dy;
      if (centreAlong <= 1 || along < -Math.min(a.width, a.height, b.width, b.height) * 0.5) continue;
      const side = dx
        ? Math.max(0, Math.max(a.top, b.top) - Math.min(a.bottom, b.bottom))
        : Math.max(0, Math.max(a.left, b.left) - Math.min(a.right, b.right));
      const score = Math.max(0, along) + side * 3;
      if (score < bestScore) {
        bestScore = score;
        best = el;
      }
    }
    return best;
  }

  private candidates(within: HTMLElement = this.root): HTMLElement[] {
    return [...within.querySelectorAll<HTMLElement>('[data-nav]')].filter((el) => this.reachable(el));
  }

  /** On show in the menu, and not disabled. */
  private reachable(el: HTMLElement): boolean {
    if (!this.root.contains(el) || el.getClientRects().length === 0) return false;
    return !this.items.get(el)?.disabled?.();
  }

  /** The navigable element under an event target, if it can take the focus. */
  private itemAt(target: EventTarget | null): HTMLElement | null {
    const el = target instanceof Element ? target.closest<HTMLElement>('[data-nav]') : null;
    return el && this.reachable(el) ? el : null;
  }
}

const isDir = (input: Input): input is Dir => input === 'up' || input === 'down' || input === 'left' || input === 'right';

const KEYS: Record<string, Input> = {
  ArrowUp: 'up',
  ArrowDown: 'down',
  ArrowLeft: 'left',
  ArrowRight: 'right',
  Enter: 'a',
  NumpadEnter: 'a',
  Space: 'a',
  Escape: 'b',
  Backspace: 'b',
  Tab: 'lb',
};
