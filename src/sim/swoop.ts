/** A canopy pass from feet reaching 3 m AGL until first ground contact. */
export interface Swoop {
  distance: number;
  seconds: number;
  entrySpeed: number;
  topSpeed: number;
}

export class SwoopTracker {
  result: Swoop | null = null;
  private ended = false;

  reset(): void {
    this.result = null;
    this.ended = false;
  }

  /** One airborne canopy step. Distances in metres, speeds over ground in m/s. */
  step(dt: number, distance: number, beforeHeight: number, height: number, beforeSpeed: number, speed: number): void {
    if (this.ended) return;
    if (beforeHeight <= 0) {
      this.ended = true;
      return;
    }
    let start = 0;
    if (!this.result) {
      if (beforeHeight > 3 && height > 3) return;
      if (beforeHeight > 3) start = (beforeHeight - 3) / (beforeHeight - height);
      const entrySpeed = beforeSpeed + (speed - beforeSpeed) * start;
      this.result = { distance: 0, seconds: 0, entrySpeed, topSpeed: entrySpeed };
    }
    // Clip both threshold crossings within a physics step, including tiny swoops.
    const end = height <= 0 ? beforeHeight / (beforeHeight - height) : 1;
    const fraction = Math.max(0, end - start);
    this.result.distance += distance * fraction;
    this.result.seconds += dt * fraction;
    this.result.topSpeed = Math.max(this.result.topSpeed, beforeSpeed + (speed - beforeSpeed) * start, beforeSpeed + (speed - beforeSpeed) * end);
    if (height <= 0) this.ended = true;
  }
}
