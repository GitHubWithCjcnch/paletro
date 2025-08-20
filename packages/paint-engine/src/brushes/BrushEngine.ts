import { Application, Container, Graphics, RenderTexture, Sprite, Texture } from "pixi.js";

/** Adaptive smoothing (faster motion = more smoothing). */
function smoothStep(prev: {x:number;y:number}, cur:{x:number;y:number}, dt:number){
  const dx = cur.x - prev.x, dy = cur.y - prev.y;
  const v = Math.hypot(dx, dy) / Math.max(dt, 1e-3); // px/sec
  // Map velocity to alpha (0..1). Higher v → lower alpha → more smoothing.
  const k = 80; // tune feel
  const alpha = Math.min(0.9, Math.max(0.15, k / (k + v)));
  return { x: prev.x + alpha * dx, y: prev.y + alpha * dy };
}

type BrushOptions = {
  size: number;          // pixels (diameter)
  color: number;         // 0xRRGGBB
  hardness?: number;     // 0..1 (not used in MVP—placeholder for soft brushes)
};

export class BrushEngine {
  private app: Application;
  private layerRT: RenderTexture;
  private layerSprite: Sprite;
  private stage: Container;
  private brushTex: Texture;
  private stamp: Sprite;         // re-used sprite for each “stamp”
  private cursor: Graphics;      // tiny circle cursor
  private drawing = false;
  private lastPt: {x:number;y:number}|null = null;
  private lastTime = 0;
  private domEl: HTMLElement;
  private _size: number;
  private _color: number;

  constructor(app: Application, containerEl: HTMLElement, opts: BrushOptions) {
    this.app = app;
    this.stage = app.stage;
    this.domEl = app.renderer.events.domElement as HTMLElement;

    this._size = opts.size;
    this._color = opts.color;

    // 1) Persistent layer we paint into (fast)
    this.layerRT = RenderTexture.create({ width: app.screen.width, height: app.screen.height, resolution: app.renderer.resolution });
    this.layerSprite = new Sprite(this.layerRT);
    this.stage.addChild(this.layerSprite);

    // 2) Brush texture (hard round for MVP)
    const g = new Graphics()
      .circle(0, 0, 64)        // base radius = 64 -> size scale later
      .fill(this._color);
    this.brushTex = app.renderer.generateTexture(g);
    this.stamp = new Sprite(this.brushTex);
    this.stamp.anchor.set(0.5);

    // 3) Cursor (tiny circle that follows pointer)
    this.cursor = new Graphics();
    this.stage.addChild(this.cursor);
    this.updateCursor(0, 0);

    // 4) Events
    this.domEl.addEventListener("pointerdown", this.onDown, { passive: true });
    this.domEl.addEventListener("pointerup", this.onUp, { passive: true });
    this.domEl.addEventListener("pointerleave", this.onUp, { passive: true });
    this.domEl.addEventListener("pointermove", this.onMove, { passive: true });

    // Resize handling – keep previous content (simple: recreate target)
    const onResize = () => this.resizeLayer();
    app.renderer.on("resize", onResize);
    (this.app as any).__onResize = onResize;
  }

  /** Public API */
  setSize = (px: number) => {
    this._size = Math.max(1, Math.min(400, px));
    this.updateCursor(undefined, undefined); // redraw outline with new size
  };

  setColor = (hex: number) => {
    this._color = hex;
    // recolor brush quick & dirty (regen texture)
    const g = new Graphics().circle(0, 0, 64).fill(this._color);
    this.brushTex.destroy(true);
    this.brushTex = this.app.renderer.generateTexture(g);
    this.stamp.texture = this.brushTex;
  };

  destroy = () => {
    this.domEl.removeEventListener("pointerdown", this.onDown);
    this.domEl.removeEventListener("pointerup", this.onUp);
    this.domEl.removeEventListener("pointerleave", this.onUp);
    this.domEl.removeEventListener("pointermove", this.onMove);
    (this.app.renderer as any).off?.("resize", (this.app as any).__onResize);
    this.cursor.destroy(true);
    this.layerSprite.destroy(true);
    this.layerRT.destroy(true);
    this.brushTex.destroy(true);
    this.stamp.destroy(true);
  };

  /** Internals */
  private updateCursor(x?: number, y?: number) {
    const cur = this.cursor;
    cur.clear();
    cur.circle(x ?? cur.x, y ?? cur.y, Math.max(2, this._size * 0.5))
      .stroke({ width: 1, color: 0x4e3a36, alpha: 0.9 })
      .fill({ color: 0xffffff, alpha: 0.0001 }); // ensure it gets pointer events
    if (x !== undefined && y !== undefined) {
      cur.position.set(x, y);
    }
  }

  private mapClientToWorld = (clientX: number, clientY: number) => {
    const out = { x: 0, y: 0 };
    // @ts-ignore - pixi events has mapPositionToPoint
    this.app.renderer.events.mapPositionToPoint(out, clientX, clientY);
    return out;
  };

  private onDown = (e: PointerEvent) => {
    this.drawing = true;
    this.lastPt = null;
    this.lastTime = performance.now();
    // draw a first stamp (with pressure)
    const p = this.mapClientToWorld(e.clientX, e.clientY);
    this.updateCursor(p.x, p.y);
    const pressure = e.pressure && e.pressure > 0 ? e.pressure : 0.8;
    this.stampAt(p.x, p.y, pressure);
  };

  private onUp = () => {
    this.drawing = false;
    this.lastPt = null;
  };

  private onMove = (e: PointerEvent) => {
    // Always move cursor
    const pNow = this.mapClientToWorld(e.clientX, e.clientY);
    this.updateCursor(pNow.x, pNow.y);

    if (!this.drawing) return;

    // Use coalesced events when available for buttery motion
    const list = (e as any).getCoalescedEvents?.() ?? [e];
    for (const ce of list) {
      const p = this.mapClientToWorld(ce.clientX, ce.clientY);
      const now = performance.now();

      if (!this.lastPt) {
        this.lastPt = p;
        this.lastTime = now;
        continue;
      }

      const dt = (now - this.lastTime) / 1000;
      const smoothed = smoothStep(this.lastPt, p, dt);
      this.stampLine(this.lastPt, smoothed, ce.pressure ?? e.pressure ?? 0.7);

      this.lastPt = smoothed;
      this.lastTime = now;
    }
  };

  private stampLine(a: {x:number;y:number}, b:{x:number;y:number}, pressure:number) {
    const spacing = Math.max(0.25 * this._size, 1); // px between stamps
    const dx = b.x - a.x, dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 0.01) {
      this.stampAt(b.x, b.y, pressure);
      return;
    }
    const steps = Math.ceil(dist / spacing);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = a.x + dx * t;
      const y = a.y + dy * t;
      this.stampAt(x, y, pressure);
    }
  }

  private stampAt(x:number, y:number, pressure:number) {
    // pressure 0..1 → scale 0.3..1.0 (MVP feel)
    const s = (0.3 + 0.7 * (isFinite(pressure) ? pressure : 0.7)) * (this._size / 128); // 128 = brushTex diameter
    this.stamp.scale.set(s);
    this.stamp.position.set(x, y);
    // Draw into the RenderTexture (persistent)
    this.app.renderer.render({ container: this.stamp, target: this.layerRT });
  }

  private resizeLayer() {
    const { width, height } = this.app.screen;
    // For MVP: simply recreate RT. (Later: copy old into new with scaling.)
    this.layerRT.destroy(true);
    this.layerRT = RenderTexture.create({ width, height, resolution: this.app.renderer.resolution });
    this.layerSprite.texture = this.layerRT;
  }
}
