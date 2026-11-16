declare module "gifenc" {
  interface Gifenc {
    GIFEncoder(): {
      writeFrame(index: Uint8Array, width: number, height: number, opts: { palette: number[][]; delay: number }): void;
      finish(): void;
      bytes(): Uint8Array;
    };
    quantize(rgba: Uint8Array | Uint8ClampedArray, numColors: number): number[][];
    applyPalette(rgba: Uint8Array | Uint8ClampedArray, palette: number[][]): Uint8Array;
  }
  const gifenc: Gifenc;
  export default gifenc;
}
