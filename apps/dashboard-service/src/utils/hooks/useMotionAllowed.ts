/**
 * The one-shot motion check of the shared components (the start loader, the
 * failure page, the atoms): a re-export of the hook the design kit keeps under
 * its own folder, so the core files that use it name no closed path. The hook
 * itself is edition-neutral (reduced motion, the viewer's Calm choice).
 */
export { useMotionAllowed, default } from '@/components/molecules/kit/motion/useMotionAllowed';
