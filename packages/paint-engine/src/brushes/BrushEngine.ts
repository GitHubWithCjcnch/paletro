import {
  Application,
  Container,
  Graphics,
  RenderTexture,
  Sprite,
  Texture,
} from "pixi.js";

function smoothStep(
  prev: { x: number; y: number },
  cur: { x: number; y: number },
  dt: number,
  k = 80,
  minAlpha = 0.15,
  maxAlpha = 0.9,
): { x: number; y: number } {
  // If dt is tiny or smoothing is disabled, skip smoothing.
  if (dt <= 0) return { x: cur.x, y: cur.y };
  const dx = cur.x - prev.x;
  const dy = cur.y - prev.y;
  const v = Math.hypot(dx, dy) / dt;
  const alpha = Math.min(maxAlpha, Math.max(minAlpha, k / (k + v)));
  return { x: prev.x + alpha * dx, y: prev.y + alpha * dy };
}

type BrushOptions = {
  size: number;
  color: number;
  hardness?: number;
  useSmoothing?: boolean;
  smoothingK?: number;
  minAlpha?: number;
  maxAlpha?: number;
};

export class BrushEngine {
  private app: Application;
  private layerRT: RenderTexture;
  private layerSprite: Sprite;
  private stage: Container;
  private brushTex: Texture;
  private stamp: Sprite;
  private cursor: Graphics;
  private drawing = false;
  private lastPt: { x: number; y: number } | null = null;
  private lastTime = 0;
  private domEl: HTMLElement;
  private _size: number;
  private _color: number;
  private useSmoothing: boolean;
  private k: number;
  private minAlpha: number;
  private maxAlpha: number;

  private onRawUpdate = (ev: Event) => {
    this.onMove(ev as unknown as PointerEvent);
  };

  constructor(app: Application, containerEl: HTMLElement, opts: BrushOptions) {
    this.app = app;
    this.stage = app.stage;
    this.domEl = app.renderer.events.domElement as HTMLElement;

    this._size = opts.size;
    this._color = opts.color;
    this.useSmoothing = opts.useSmoothing ?? true;
    this.k = opts.smoothingK ?? 80;
    this.minAlpha = opts.minAlpha ?? 0.15;
    this.maxAlpha = opts.maxAlpha ?? 0.9;

    this.layerRT = RenderTexture.create({
      width: app.screen.width,
      height: app.screen.height,
      resolution: app.renderer.resolution,
    });
    this.layerSprite = new Sprite(this.layerRT);
    this.stage.addChild(this.layerSprite);

    // Create a master brush texture (white circle).
    const g = new Graphics().circle(0, 0, 64).fill(0xffffff);
    this.brushTex = app.renderer.generateTexture(g);
    this.stamp = new Sprite(this.brushTex);
    this.stamp.anchor.set(0.5);
    this.stamp.tint = this._color;

    // Cursor graphics.
    this.cursor = new Graphics();
    this.stage.addChild(this.cursor);
    this.updateCursorShape();
    this.updateCursorPos(0, 0);

    // Attach pointer listeners.
    const listenerOpts = { passive: true } as const;
    this.domEl.addEventListener("pointerdown", this.onDown, listenerOpts);
    this.domEl.addEventListener("pointerup", this.onUp, listenerOpts);
    this.domEl.addEventListener("pointerleave", this.onUp, listenerOpts);
    this.domEl.addEventListener("pointermove", this.onMove, listenerOpts);
    this.domEl.addEventListener("pointerrawupdate", this.onRawUpdate as EventListener, listenerOpts);

    const onResize = () => this.resizeLayer();
    app.renderer.on("resize", onResize);
    (this.app as any).__onResize = onResize;
  }

  setSize = (px: number) => {
    this._size = Math.max(1, Math.min(400, px));
    this.updateCursorShape();
  };

  /** Change the brush tint colour. */
  setColor = (hex: number) => {
    this._color = hex;
    this.stamp.tint = hex;
  };

  /** Enable or disable smoothing dynamically. */
  setSmoothing = (enabled: boolean) => {
    this.useSmoothing = enabled;
  };

  destroy = () => {
    this.domEl.removeEventListener("pointerdown", this.onDown);
    this.domEl.removeEventListener("pointerup", this.onUp);
    this.domEl.removeEventListener("pointerleave", this.onUp);
    this.domEl.removeEventListener("pointermove", this.onMove);
    this.domEl.removeEventListener("pointerrawupdate", this.onRawUpdate as EventListener);
    (this.app.renderer as any).off?.("resize", (this.app as any).__onResize);
    this.cursor.destroy(true);
    this.layerSprite.destroy(true);
    this.layerRT.destroy(true);
    this.brushTex.destroy(true);
    this.stamp.destroy(true);
  };

  /** Draw the cursor graphic when the size changes. */
  private updateCursorShape() {
    const cur = this.cursor;
    cur.clear();
    cur.circle(0, 0, Math.max(2, this._size * 0.5))
      .stroke({ width: 1, color: 0x4e3a36, alpha: 0.9 })
      .fill({ color: 0xffffff, alpha: 0.0001 });
  }

  /** Only update the cursor’s position. */
  private updateCursorPos(x: number, y: number) {
    this.cursor.position.set(x, y);
  }

  private mapClientToWorld = (clientX: number, clientY: number) => {
    const out = { x: 0, y: 0 };
    this.app.renderer.events.mapPositionToPoint(out, clientX, clientY);
    return out;
  };

  private onDown = (e: PointerEvent) => {
    this.drawing = true;
    this.lastTime = performance.now();
    const p = this.mapClientToWorld(e.clientX, e.clientY);
    this.updateCursorPos(p.x, p.y);

    const pressure = e.pressure && e.pressure > 0 ? e.pressure : 1;
    this.stampAt(p.x, p.y, pressure);
    this.lastPt = p;
  };

  private onUp = () => {
    this.drawing = false;
    this.lastPt = null;
  };

  private onMove = (e: PointerEvent) => {
    const pNow = this.mapClientToWorld(e.clientX, e.clientY);
    this.updateCursorPos(pNow.x, pNow.y);
    if (!this.drawing || !this.lastPt) return;

    // Process coalesced events for high precision.
    const events = (e as any).getCoalescedEvents?.() ?? [e];
    for (const ce of events) {
      const p = this.mapClientToWorld(ce.clientX, ce.clientY);
      const now = performance.now();
      const dt = (now - this.lastTime) / 1000;

      let target = p;
      if (this.useSmoothing) {
        target = smoothStep(
          this.lastPt,
          p,
          dt,
          this.k,
          this.minAlpha,
          this.maxAlpha,
        );
      }
      this.stampLine(this.lastPt, target, ce.pressure ?? e.pressure ?? 1);
      this.lastPt = target;
      this.lastTime = now;
    }
  };

  private stampLine(
    a: { x: number; y: number },
    b: { x: number; y: number },
    pressure: number,
  ) {
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const dist = Math.hypot(dx, dy);
    const spacing = Math.max(0.25 * this._size, 1);

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

  private stampAt(x: number, y: number, pressure: number) {
    // Scale the sprite based on pressure and brush size.
    const p = isFinite(pressure) ? pressure : 1;
    const s = (0.3 + 0.7 * p) * (this._size / 128);
    this.stamp.scale.set(s);
    this.stamp.position.set(x, y);

    this.app.renderer.render({
      container: this.stamp,
      target: this.layerRT,
      clear: false,
    });
  }

  private resizeLayer() {
    const { width, height } = this.app.screen;
    this.layerRT.destroy(true);
    this.layerRT = RenderTexture.create({
      width,
      height,
      resolution: this.app.renderer.resolution,
    });
    this.layerSprite.texture = this.layerRT;
  }
}
