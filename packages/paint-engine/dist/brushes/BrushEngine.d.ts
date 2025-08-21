import { Application } from "pixi.js";
type BrushOptions = {
    size: number;
    color: number;
    hardness?: number;
    useSmoothing?: boolean;
    smoothingK?: number;
    minAlpha?: number;
    maxAlpha?: number;
};
export declare class BrushEngine {
    private app;
    private layerRT;
    private layerSprite;
    private stage;
    private brushTex;
    private stamp;
    private cursor;
    private drawing;
    private lastPt;
    private lastTime;
    private domEl;
    private _size;
    private _color;
    private useSmoothing;
    private k;
    private minAlpha;
    private maxAlpha;
    private onRawUpdate;
    constructor(app: Application, containerEl: HTMLElement, opts: BrushOptions);
    setSize: (px: number) => void;
    /** Change the brush tint colour. */
    setColor: (hex: number) => void;
    /** Enable or disable smoothing dynamically. */
    setSmoothing: (enabled: boolean) => void;
    destroy: () => void;
    /** Draw the cursor graphic when the size changes. */
    private updateCursorShape;
    /** Only update the cursor’s position. */
    private updateCursorPos;
    private mapClientToWorld;
    private onDown;
    private onUp;
    private onMove;
    private stampLine;
    private stampAt;
    private resizeLayer;
}
export {};
