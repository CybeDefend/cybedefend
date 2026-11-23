// Priority assignment for SECRET findings.
//
// Exploitability does not apply to secrets — a hardcoded credential IS the
// exploit, so there is no separate "is this reachable/exploitable?" signal to
// weigh. Secret priority is therefore deterministic and is NOT the multi-signal
// composite (CVSS/EPSS/exploitability/context) used for SAST/SCA/IAC/CICD/
// container findings.
//
// The file context is NOT a demotion signal either: a secret committed into a
// test file is still a real leaked credential, so every secret is always
// `critical_urgent`. The numeric `priorityScore` (0-100) mirrors the band so
// server-side sorting and the dashboard stay consistent with calculator-derived
// findings — `critical_urgent` lives in the >= 80 band.

export interface SecretPriorityResult {
  priority: string;
  priorityScore: number;
}

export function computeSecretPriority(): SecretPriorityResult {
  return { priority: 'critical_urgent', priorityScore: 100 };
}
