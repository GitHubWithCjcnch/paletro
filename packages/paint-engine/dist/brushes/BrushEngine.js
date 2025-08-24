import { Container, Graphics, RenderTexture, Sprite, } from "pixi.js";
function smoothStep(prev, cur, dt, k = 80, minAlpha = 0.15, maxAlpha = 0.9) {
    if (dt <= 0) {
        return { x: cur.x, y: cur.y };
    }
    const dx = cur.x - prev.x;
    const dy = cur.y - prev.y;
    const v = Math.hypot(dx, dy) / dt;
    const alpha = Math.min(maxAlpha, Math.max(minAlpha, k / (k + v)));
    return {
        x: prev.x + alpha * dx,
        y: prev.y + alpha * dy,
    };
}
export class BrushEngine {
    app;
    stage;
    layerRT;
    layerSprite;
    strokeContainer;
    cursor;
    brushTex;
    drawing = false;
    lastPt = null;
    lastTime = 0;
    domEl;
    _size;
    _color;
    useSmoothing;
    k;
    minAlpha;
    maxAlpha;
    onRawUpdate = (ev) => {
        this.onMove(ev);
    };
    constructor(app, containerEl, opts) {
        this.app = app;
        this.stage = app.stage;
        this.domEl = app.renderer.events.domElement;
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
        this.strokeContainer = new Container();
        this.stage.addChild(this.strokeContainer);
        const g = new Graphics().circle(0, 0, 64).fill(0xffffff);
        this.brushTex = app.renderer.generateTexture(g);
        this.cursor = new Graphics();
        this.stage.addChild(this.cursor);
        this.updateCursorShape();
        this.updateCursorPos(0, 0);
        const listenerOpts = { passive: true };
        this.domEl.addEventListener("pointerdown", this.onDown, listenerOpts);
        this.domEl.addEventListener("pointerup", this.onUp, listenerOpts);
        this.domEl.addEventListener("pointerleave", this.onUp, listenerOpts);
        this.domEl.addEventListener("pointermove", this.onMove, listenerOpts);
        this.domEl.addEventListener("pointerrawupdate", this.onRawUpdate, listenerOpts);
        const onResize = () => this.resizeLayer();
        app.renderer.on("resize", onResize);
        this.app.__onResize = onResize;
    }
    setSize = (px) => {
        this._size = Math.max(1, Math.min(400, px));
        this.updateCursorShape();
    };
    setColor = (hex) => {
        this._color = hex;
    };
    setSmoothing = (enabled) => {
        this.useSmoothing = enabled;
    };
    destroy = () => {
        this.domEl.removeEventListener("pointerdown", this.onDown);
        this.domEl.removeEventListener("pointerup", this.onUp);
        this.domEl.removeEventListener("pointerleave", this.onUp);
        this.domEl.removeEventListener("pointermove", this.onMove);
        this.domEl.removeEventListener("pointerrawupdate", this.onRawUpdate);
        this.app.renderer.off?.("resize", this.app.__onResize);
        this.commitStroke();
        this.cursor.destroy(true);
        this.layerSprite.destroy(true);
        this.layerRT.destroy(true);
        this.brushTex.destroy(true);
        this.strokeContainer.destroy(true);
    };
    updateCursorShape() {
        const cur = this.cursor;
        cur.clear();
        cur.circle(0, 0, Math.max(2, this._size * 0.5))
            .stroke({ width: 1, color: 0x4e3a36, alpha: 0.9 })
            .fill({ color: 0xffffff, alpha: 0.0001 });
    }
    updateCursorPos(x, y) {
        this.cursor.position.set(x, y);
    }
    mapClientToWorld = (clientX, clientY) => {
        const out = { x: 0, y: 0 };
        this.app.renderer.events.mapPositionToPoint(out, clientX, clientY);
        return out;
    };
    onDown = (e) => {
        this.commitStroke();
        this.drawing = true;
        this.lastTime = performance.now();
        const p = this.mapClientToWorld(e.clientX, e.clientY);
        this.updateCursorPos(p.x, p.y);
        const pressure = e.pressure && e.pressure > 0 ? e.pressure : 1;
        this.stampAt(p.x, p.y, pressure);
        this.lastPt = p;
    };
    onUp = () => {
        this.drawing = false;
        this.lastPt = null;
        this.commitStroke();
    };
    onMove = (e) => {
        const pNow = this.mapClientToWorld(e.clientX, e.clientY);
        this.updateCursorPos(pNow.x, pNow.y);
        if (!this.drawing || !this.lastPt)
            return;
        const events = e.getCoalescedEvents?.() ?? [e];
        for (const ce of events) {
            const p = this.mapClientToWorld(ce.clientX, ce.clientY);
            const now = performance.now();
            const dt = (now - this.lastTime) / 1000;
            let target = p;
            if (this.useSmoothing) {
                target = smoothStep(this.lastPt, p, dt, this.k, this.minAlpha, this.maxAlpha);
            }
            this.stampLine(this.lastPt, target, ce.pressure ?? e.pressure ?? 1);
            this.lastPt = target;
            this.lastTime = now;
        }
    };
    stampLine(a, b, pressure) {
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
    stampAt(x, y, pressure) {
        const p = isFinite(pressure) ? pressure : 1;
        const s = (0.3 + 0.7 * p) * (this._size / 128);
        const sprite = new Sprite(this.brushTex);
        sprite.anchor.set(0.5);
        sprite.tint = this._color;
        sprite.scale.set(s);
        sprite.position.set(x, y);
        this.strokeContainer.addChild(sprite);
    }
    commitStroke() {
        if (this.strokeContainer.children.length > 0) {
            this.app.renderer.render({
                container: this.strokeContainer,
                target: this.layerRT,
                clear: false,
            });
            this.strokeContainer.removeChildren();
        }
    }
    resizeLayer() {
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
