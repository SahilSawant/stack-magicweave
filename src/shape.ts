/**
 * The shape of screen this game is built for, and the box it plays in.
 *
 * Nothing in the product had ever chosen this. The canvas filled the window
 * (100vw × 100vh) and the console's preview was a hard-coded 4:3 box, so every
 * game was already being shown in a shape it was not authored for — and
 * neither number was a decision anybody made.
 *
 * The line below is rewritten when the workspace is created, from the shape
 * chosen at intake. "fill" is what every game before this behaved like and is
 * the one value that changes nothing: the canvas takes the whole window.
 */
export type Shape = "portrait" | "landscape" | "square" | "fill";

export const SHAPE: Shape = "portrait";

/** The aspect each shape is authored at. `null` means "whatever it is given". */
const ASPECT: Record<Shape, number | null> = {
  portrait: 9 / 16,
  landscape: 16 / 9,
  square: 1,
  fill: null,
};

/**
 * The largest box of this game's shape that fits the window, centred.
 *
 * A player's window is never the shape a game was authored for, so the game
 * letterboxes itself rather than stretching: a portrait game in a desktop
 * window is a tall panel in the middle of the screen, which is what a phone
 * game looks like on a desktop everywhere else. `fill` returns the window
 * untouched, so a game built before shapes existed behaves exactly as it did.
 */
export function stageBox(
  windowWidth: number,
  windowHeight: number,
  shape: Shape = SHAPE,
): { width: number; height: number; left: number; top: number } {
  const aspect = ASPECT[shape];
  if (aspect === null) {
    return { width: windowWidth, height: windowHeight, left: 0, top: 0 };
  }
  // Fit by whichever dimension runs out first.
  const byWidth = windowWidth / aspect <= windowHeight;
  const width = byWidth ? windowWidth : windowHeight * aspect;
  const height = byWidth ? windowWidth / aspect : windowHeight;
  return {
    width: Math.floor(width),
    height: Math.floor(height),
    left: Math.floor((windowWidth - width) / 2),
    top: Math.floor((windowHeight - height) / 2),
  };
}
