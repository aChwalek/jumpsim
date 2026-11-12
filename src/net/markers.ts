import * as THREE from 'three';

/** Someone to point at. */
export interface MarkerTarget {
  id: string;
  name: string;
  /** Over their head, world frame. */
  pos: THREE.Vector3;
  /** Their canopy's colour. */
  color: string;
}

/** How far in from the screen's edge the arrows stay, px: enough for the tag under them. */
const EDGE_X = 80;
const EDGE_Y = 46;
/** Closer than this, m, no marker: they are right there. */
const NEAR = 4;
/** A height difference worth saying, m. */
const ABOVE = 10;

const CSS = `
#markers { position: absolute; inset: 0; overflow: hidden; }
#markers .marker { position: absolute; left: 0; top: 0; will-change: transform; }
#markers .tag {
  position: absolute; left: 0; bottom: 9px; transform: translateX(-50%); white-space: nowrap;
  padding: 2px 8px 3px; border-radius: 9px; background: rgba(8, 12, 18, 0.55); border: 1px solid var(--c);
  font-size: 12.5px; font-weight: 600; line-height: 1.25; text-align: center;
}
#markers .tag small { display: block; font-size: 11px; font-weight: 500; opacity: 0.85; }
#markers .pin {
  position: absolute; left: -5px; top: -5px; width: 10px; height: 10px; box-sizing: border-box;
  border: 2px solid var(--c); border-radius: 50%; box-shadow: 0 0 4px rgba(0, 0, 0, 0.6);
}
#markers .arrow {
  position: absolute; left: -11px; top: -11px; width: 22px; height: 22px; display: none;
  filter: drop-shadow(0 1px 3px rgba(0, 0, 0, 0.7));
}
#markers .arrow path { fill: var(--c); stroke: rgba(0, 0, 0, 0.5); stroke-width: 1; }
#markers .off .pin { display: none; }
#markers .off .arrow { display: block; }
#markers .off .tag { bottom: auto; top: 14px; }
`;

interface Item {
  root: HTMLElement;
  name: HTMLElement;
  info: HTMLElement;
  arrow: SVGElement;
}

/**
 * Where the others are: a tag over each one in sight, with their name and
 * how far, and an arrow at the edge of the screen for those out of it.
 */
export class Markers {
  private readonly el: HTMLElement;
  private readonly items = new Map<string, Item>();
  private readonly v = new THREE.Vector3();

  constructor(hud: HTMLElement) {
    if (!document.getElementById('markers-style')) {
      const style = document.createElement('style');
      style.id = 'markers-style';
      style.textContent = CSS;
      document.head.append(style);
    }
    this.el = document.createElement('div');
    this.el.id = 'markers';
    // Hidden with the rest of the flight's HUD, and behind the menu.
    this.el.className = 'flight';
    hud.prepend(this.el);
  }

  update(camera: THREE.PerspectiveCamera, targets: MarkerTarget[]): void {
    camera.updateMatrixWorld();
    const w = this.el.clientWidth;
    const h = this.el.clientHeight;
    const seen = new Set<string>();
    for (const t of targets) {
      const distance = t.pos.distanceTo(camera.position);
      if (distance < NEAR) continue;
      seen.add(t.id);
      const item = this.item(t.id);
      item.root.style.setProperty('--c', t.color);
      item.name.textContent = t.name;
      const dy = t.pos.y - camera.position.y;
      item.info.textContent = `${Math.round(distance)} m${Math.abs(dy) >= ABOVE ? ` · ${dy > 0 ? '▲' : '▼'} ${Math.round(Math.abs(dy))} m` : ''}`;

      // In the camera's frame: ahead is -z.
      const v = this.v.copy(t.pos).applyMatrix4(camera.matrixWorldInverse);
      let x = 0;
      let y = 0;
      let off = v.z >= 0;
      if (!off) {
        this.v.copy(t.pos).project(camera);
        x = ((this.v.x + 1) / 2) * w;
        y = ((1 - this.v.y) / 2) * h;
        off = x < EDGE_Y || x > w - EDGE_Y || y < EDGE_Y || y > h - EDGE_Y;
        v.copy(t.pos).applyMatrix4(camera.matrixWorldInverse);
      }
      if (off) {
        // Which way to turn: towards them across the screen, held in from its edge.
        let dx = v.x;
        let dyScreen = -v.y;
        const length = Math.hypot(dx, dyScreen);
        if (length < 1e-6) [dx, dyScreen] = [0, 1];
        else [dx, dyScreen] = [dx / length, dyScreen / length];
        const reach = Math.min((w / 2 - EDGE_X) / Math.max(Math.abs(dx), 1e-6), (h / 2 - EDGE_Y) / Math.max(Math.abs(dyScreen), 1e-6));
        x = w / 2 + dx * reach;
        y = h / 2 + dyScreen * reach;
        item.arrow.style.transform = `rotate(${Math.atan2(dyScreen, dx)}rad)`;
      }
      item.root.classList.toggle('off', off);
      item.root.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px)`;
      item.root.hidden = false;
    }
    for (const [id, item] of this.items) {
      if (!seen.has(id)) item.root.hidden = true;
    }
  }

  /** Someone has left: their marker goes. */
  remove(id: string): void {
    this.items.get(id)?.root.remove();
    this.items.delete(id);
  }

  dispose(): void {
    this.el.remove();
    this.items.clear();
  }

  private item(id: string): Item {
    let item = this.items.get(id);
    if (item) return item;
    const root = document.createElement('div');
    root.className = 'marker';
    const tag = document.createElement('div');
    tag.className = 'tag';
    const name = document.createElement('span');
    const info = document.createElement('small');
    tag.append(name, info);
    const pin = document.createElement('div');
    pin.className = 'pin';
    root.innerHTML = '<svg class="arrow" viewBox="-11 -11 22 22"><path d="M 9 0 L -6 -7 L -3 0 L -6 7 Z"/></svg>';
    const arrow = root.querySelector('svg') as SVGElement;
    root.append(pin, tag);
    this.el.append(root);
    item = { root, name, info, arrow };
    this.items.set(id, item);
    return item;
  }
}
