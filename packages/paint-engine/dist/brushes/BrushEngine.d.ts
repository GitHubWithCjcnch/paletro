import { Application } from "pixi.js";
type BrushOptions = {
    size: number;
    color: number;
    hardness?: number;
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
    constructor(app: Application, containerEl: HTMLElement, opts: BrushOptions);
    /** Public API */
    setSize: (px: number) => void;
    setColor: (hex: number) => void;
    destroy: () => void;
    /** Internals */
    private updateCursor;
    private mapClientToWorld;
    private onDown;
    private onUp;
    private onMove;
    private stampLine;
    private stampAt;
    private resizeLayer;
}
export {};
