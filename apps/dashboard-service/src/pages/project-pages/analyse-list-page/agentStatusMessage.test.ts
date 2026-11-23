import { describe, it, expect } from 'vitest';
import i18next from 'i18next';
import en from '@/i18n/locales/en/components/loaderScan/_self.json';
import fr from '@/i18n/locales/fr/components/loaderScan/_self.json';
import { agentStatusMessage } from './agentStatusMessage';

/**
 * The scan loader's line about the AI agent read « Analysis completed 3/10 |
 * TP=2 »: a log line, in English on a French screen. It is now a sentence in
 * the interface's language, built from the same step fields.
 */
const i18n = i18next.createInstance();
void i18n.init({
  lng: 'en',
  resources: { en: { translation: en }, fr: { translation: fr } },
  interpolation: { escapeValue: false },
});
const tEn = i18n.getFixedT('en');
const tFr = i18n.getFixedT('fr');

describe('agentStatusMessage', () => {
  it('says nothing without a step', () => {
    expect(agentStatusMessage(null, undefined, undefined, tEn)).toBeUndefined();
  });

  it('writes a completed analysis as one sentence', () => {
    const step = { phase: 'analysis', action: 'done', processed: 3, total: 10, tp: 2 };
    expect(agentStatusMessage(step, 'analysis', 'done', tEn)).toBe(
      'Analysis completed, 3 of 10 findings reviewed, 2 confirmed',
    );
    expect(agentStatusMessage(step, 'analysis', 'done', tFr)).toBe(
      'Analyse terminée, 3 sur 10 vulnérabilités examinées, 2 confirmées',
    );
  });

  it('names false positives and failures with their plural', () => {
    const step = { phase: 'analysis', action: 'start', tp: 1, fp: 1, err: 2 };
    expect(agentStatusMessage(step, 'analysis', 'start', tEn)).toBe(
      'Analysis started, 1 confirmed, 1 false positive, 2 could not be reviewed',
    );
    expect(agentStatusMessage({ ...step, fp: 4, err: 1 }, 'analysis', 'start', tFr)).toBe(
      "Analyse démarrée, 1 confirmée, 4 faux positifs, 1 n'a pas pu être examinée",
    );
  });

  it('keeps an analysis in progress readable with or without figures', () => {
    expect(agentStatusMessage({ phase: 'analysis', processed: 5, total: 8 }, 'analysis', undefined, tEn)).toBe(
      'Analysis in progress, 5 of 8 findings reviewed',
    );
    expect(agentStatusMessage({ phase: 'analysis' }, 'analysis', undefined, tEn)).toBe('Analyzing…');
  });

  it('never prints a code-like fact', () => {
    const step = { phase: 'analysis', action: 'done', processed: 3, total: 10, tp: 2, fp: 1, err: 0 };
    for (const t of [tEn, tFr]) {
      const message = agentStatusMessage(step, 'analysis', 'done', t) ?? '';
      expect(message).not.toMatch(/TP=|FP=|err=|\d\/\d|\||·|•|—/);
    }
  });

  it('translates the other phases', () => {
    expect(agentStatusMessage({ phase: 'vuln', action: 'start' }, 'vuln', 'start', tEn)).toBe('Analyzing a vulnerability…');
    expect(agentStatusMessage({ phase: 'vuln', action: 'result' }, 'vuln', 'result', tFr)).toBe(
      'Résultats affinés pour une vulnérabilité',
    );
    expect(agentStatusMessage({ phase: 'prioritization', action: 'decided' }, 'prioritization', 'decided', tEn)).toBe(
      'Prioritization decisions applied',
    );
    expect(agentStatusMessage({ phase: 'parsing' }, 'parsing', 'in_progress', tFr)).toBe('Traitement des données du scan…');
    expect(agentStatusMessage({ phase: 'ingestion' }, 'ingestion', undefined, tEn)).toBe('Preparing data for analysis…');
    expect(agentStatusMessage({ phase: 'other' }, 'other', undefined, tEn)).toBeUndefined();
  });

  it('defines every key in both locales', () => {
    const keys = Object.keys((en as any).components.loaderScan.agentStatus).sort();
    expect(Object.keys((fr as any).components.loaderScan.agentStatus).sort()).toEqual(keys);
  });
});
