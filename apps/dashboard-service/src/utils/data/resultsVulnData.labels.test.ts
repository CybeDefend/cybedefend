import { afterAll, describe, it, expect } from 'vitest';
import i18n from '@/i18n';
import {
  orderDirectionOptions,
  orderOptions,
  priorityOptions,
  severityOptions,
  statusOptions,
} from './resultsVulnData';

/*
  The results lists hand these options to the filter and sort menus of every
  results page. Their labels were English literals, so a French page read
  « Descending » next to « Trier par ». Each label
  is now read from the locales in the current language when it is shown.
*/

const labels = (options: ReadonlyArray<{ label: string }>) => options.map((o) => o.label);

describe('results list options', () => {
  afterAll(async () => {
    await i18n.changeLanguage('en');
  });

  it('speak English in English', async () => {
    await i18n.changeLanguage('en');
    expect(labels(orderDirectionOptions)).toEqual(['Ascending', 'Descending']);
    expect(labels(orderOptions)).toEqual(['Severity', 'Status', 'Priority', 'First Detection']);
    expect(labels(severityOptions)).toEqual(['Critical', 'High', 'Medium', 'Low']);
    expect(labels(statusOptions)).toEqual(['To Verify', 'Resolved', 'Confirmed', 'Ignored']);
    expect(labels(priorityOptions)).toEqual(['Critical Urgent', 'Urgent', 'Normal', 'Low', 'Very Low']);
  });

  it('speak French in French', async () => {
    await i18n.changeLanguage('fr');
    expect(labels(orderDirectionOptions)).toEqual(['Croissant', 'Décroissant']);
    expect(labels(orderOptions)).toEqual(['Sévérité', 'Statut', 'Priorité', 'Première détection']);
    expect(labels(severityOptions)).toEqual(['Critique', 'Élevée', 'Moyenne', 'Faible']);
    expect(labels(statusOptions)).toEqual(['À vérifier', 'Résolue', 'Confirmée', 'Ignorée']);
    expect(labels(priorityOptions)).toEqual(['Critique urgent', 'Urgent', 'Normal', 'Faible', 'Très faible']);
  });

  it('keep their values, which are what the API filters on', () => {
    expect(orderDirectionOptions.map((o) => o.value)).toEqual(['asc', 'desc']);
    expect(severityOptions.map((o) => o.value)).toEqual(['critical', 'high', 'medium', 'low']);
    expect(priorityOptions.map((o) => o.value)).toEqual(['critical_urgent', 'urgent', 'normal', 'low', 'very_low']);
  });
});
