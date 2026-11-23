import { useLivingMotion } from '@/components/molecules/kit/motion/useLivingMotion';

const canAnimate = (): boolean =>
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  typeof window.requestAnimationFrame === 'function';

/**
 * Whether a one-shot transition of a zinc-kit space may play: a figure
 * counting up, a meter growing from zero, a new row sliding in.
 *
 * Not on a calm page (`useLivingMotion`: reduced motion, or the viewer's Calm
 * choice). And not where the browser cannot be seen to run it: without
 * `matchMedia` or `requestAnimationFrame` (jsdom, SSR) the final state is
 * drawn at once, so a test reads the final text and nobody waits on a frame
 * that never comes.
 */
export function useMotionAllowed(): boolean {
  const { calm } = useLivingMotion();
  return !calm && canAnimate();
}

export default useMotionAllowed;
