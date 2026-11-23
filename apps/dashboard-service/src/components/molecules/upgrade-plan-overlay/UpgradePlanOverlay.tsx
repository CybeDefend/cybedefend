import React from 'react';
import { ACTIVE_EXTENSIONS } from '@/edition/active';
import type { UpgradePlanOverlayProps } from '@/edition/extensions';

/**
 * The overlay over a card the organisation's plan does not include: the
 * edition's own (`ACTIVE_EXTENSIONS.billing.UpgradePlanOverlay`), which locks
 * the card and offers the upgrade. Without a plan (the Community Edition)
 * nothing is locked: the card shows as it is.
 */
const UpgradePlanOverlay: React.FC<UpgradePlanOverlayProps> = (props) => {
  const Overlay = ACTIVE_EXTENSIONS.billing?.UpgradePlanOverlay ?? null;
  if (!Overlay) return <>{props.children}</>;
  return <Overlay {...props} />;
};

export default UpgradePlanOverlay;
