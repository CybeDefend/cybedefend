import { createFaIcon } from './iconFactory';

/**
 * The CybeDefend eye — our own mark, so it stays in the core of every edition.
 *
 * The three shapes of the eye (left half, right half, pupil), in drawing
 * order, in the square `0 0 497 497` box they are drawn in. `EyeMark` renders
 * them through the same factory as every vendor glyph, so the mark inherits
 * `currentColor` and answers to `h-5 w-5` like a sibling; `EYE_MARK_PATH` is
 * the same geometry as one string, for a canvas
 * (`new Path2D(EYE_MARK_PATH)` then scale by `size / EYE_MARK_SIZE`).
 */

/** Edge of the square box the eye is drawn in (its `viewBox` is `0 0 497 497`). */
export const EYE_MARK_SIZE = 497;

/** The three shapes of the eye, in drawing order. */
export const EYE_MARK_SHAPES: readonly string[] = [
  'M139.66 388.4 L31.98 280.72 C8.25 256.98 8.25 218.5 31.98 194.76 L139.66 87.08 C145.36 81.38 153.09 78.18 161.15 78.18 L270.22 78.18 L235.83 129.77 C230.19 138.23 220.7 143.31 210.54 143.31 L193.52 143.31 C182.01 143.31 170.96 147.88 162.82 156.02 L162.82 156.02 C117.69 201.15 117.69 274.32 162.82 319.45 L162.82 319.45 C170.96 327.6 182.01 332.17 193.52 332.17 L219.2 332.17 C223.4 332.17 226.8 335.57 226.8 339.77 L226.8 397.3 L161.15 397.3 C153.09 397.3 145.36 394.1 139.66 388.4 Z',
  'M226.8 419.01 L261.2 367.41 C266.84 358.96 276.32 353.88 286.49 353.88 L303.5 353.88 C315.02 353.88 326.06 349.31 334.2 341.16 L334.2 341.16 C379.33 296.03 379.33 222.86 334.2 177.73 L334.2 177.73 C326.06 169.59 315.02 165.02 303.5 165.02 L226.8 165.02 L261.2 113.42 C266.84 104.97 276.32 99.89 286.49 99.89 L335.87 99.89 C343.93 99.89 351.67 103.09 357.37 108.79 L465.04 216.47 C488.78 240.2 488.78 278.69 465.04 302.43 L357.36 410.11 C351.66 415.81 343.93 419.01 335.87 419.01 Z',
  'M296.64 248.6 C296.64 275.49 273.37 296.94 245.86 293.9 C225 291.6 208.05 274.65 205.74 253.79 C202.71 226.28 224.15 203.01 251.05 203.01 C256.39 203.01 261.51 203.92 266.24 205.57 L266.24 218.21 C266.24 226.6 273.05 233.4 281.44 233.4 L294.07 233.4 C295.72 238.14 296.64 243.26 296.64 248.6 Z',
];

/** The eye's path data as one string, in the same `0 0 497 497` box, for a canvas. */
export const EYE_MARK_PATH = EYE_MARK_SHAPES.join(' ');

/**
 * The bare CybeDefend eye, no bubble and no wordmark, as an icon-row glyph:
 * same props, same `cybe-icon-*` selector hook and same `currentColor` fill as
 * any other glyph.
 */
export const EyeMark = createFaIcon('EyeMark', {
  prefix: 'cybe',
  iconName: 'eye-mark',
  icon: [EYE_MARK_SIZE, EYE_MARK_SIZE, [], '', [...EYE_MARK_SHAPES]],
} as never);
