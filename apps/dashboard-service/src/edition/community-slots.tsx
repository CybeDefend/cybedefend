import type { SlotRegistration } from './slots';
import AiAnalysisUpsellPanel from './upsell/AiAnalysisUpsellPanel';

// The only home of COMMUNITY_SLOTS: what the Community build renders in
// place of the ee slots, the upsell registrations included.
export const COMMUNITY_SLOTS: SlotRegistration[] = [
  // No rail entry: the editions page is reached from the
  // Get started page's Cloud banner, the URL and the upsells that lead to it.
  // An issue page's line on Cybe Analysis (one host per page, see the panel).
  { slot: 'finding.panels', id: 'upsell-ai-analysis', order: 1000, render: (ctx) => <AiAnalysisUpsellPanel ctx={ctx} /> },
];
