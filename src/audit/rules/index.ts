import { contentRules } from './content';
import { gscRules } from './gsc';
import { indexabilityRules } from './indexability';
import { mediaRules } from './media';
import { metadataRules } from './metadata';
import { psiRules } from './psi';
import { schemaRules } from './schema';
import { semanticRules } from './semantics';
import { technicalRules } from './technical';
import type { Rule } from '../types';

/**
 * Registro unico delle regole di audit.
 * L’ordine non conta: il motore ordina le issue per severità e copertura.
 */
export const ALL_RULES: Rule[] = [
  ...indexabilityRules,
  ...metadataRules,
  ...contentRules,
  ...semanticRules,
  ...mediaRules,
  ...schemaRules,
  ...technicalRules,
  ...psiRules,
  ...gscRules,
];

const seen = new Set<string>();
for (const rule of ALL_RULES) {
  if (seen.has(rule.id)) {
    throw new Error('Regola duplicata nel registro: ' + rule.id);
  }
  seen.add(rule.id);
}

export function ruleById(id: string): Rule | undefined {
  return ALL_RULES.find((rule) => rule.id === id);
}
