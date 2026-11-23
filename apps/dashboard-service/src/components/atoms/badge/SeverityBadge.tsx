import React from 'react';
import SeverityChip from '@/components/atoms/badge/SeverityChip';
import { AS_SENTENCE_CASE } from '@/components/atoms/appsec/styles';

interface SeverityBadgeProps {
  severity: 'low' | 'medium' | 'high' | 'critical' | 'fixed';
  /** `md` (default) at the head of a finding, `sm` in a list. */
  size?: 'sm' | 'md';
}

/*
  A finding's severity, in both spaces (the Cybe chat renders it in each): the
  shared soft chip in the severity's colour (outlined), read in sentence case. The string stays uppercase
  in the DOM; CSS lowercases it and raises its first letter.
*/
const SeverityBadge: React.FC<SeverityBadgeProps> = ({ severity, size = 'md' }) => (
  <SeverityChip level={severity} size={size}>
    <span className={AS_SENTENCE_CASE}>{severity.toUpperCase()}</span>
  </SeverityChip>
);

export default SeverityBadge;
