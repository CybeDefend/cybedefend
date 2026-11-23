import 'reflect-metadata';
import * as YAML from 'yaml';
import { CreatePolicyBodyDto } from './create-policy-body.dto';
import { UpdatePolicyBodyDto } from './update-policy-body.dto';

/**
 * The YAML samples of the policy API description must be policies the
 * policy service accepts: every rule operator is one it knows.
 */
const VALID_OPERATORS = [
  'equals',
  'not_equals',
  'gt',
  'gte',
  'lt',
  'lte',
  'in',
  'not_in',
];

function yamlSamples(dto: { prototype: object }): string[] {
  const meta = Reflect.getMetadata(
    'swagger/apiModelProperties',
    dto.prototype,
    'yamlContent',
  ) as { description: string; example: string };
  const fenced = /```yaml\n([\s\S]*?)```/.exec(meta.description);
  return [fenced?.[1] ?? '', meta.example];
}

describe('policy body DTO examples', () => {
  it.each([
    ['CreatePolicyBodyDto', CreatePolicyBodyDto],
    ['UpdatePolicyBodyDto', UpdatePolicyBodyDto],
  ])('%s samples use only valid rule operators', (_name, dto) => {
    for (const sample of yamlSamples(dto)) {
      const parsed = YAML.parse(sample) as {
        rules: Array<{ operator?: string }>;
      };
      expect(parsed.rules.length).toBeGreaterThan(0);
      for (const rule of parsed.rules) {
        expect(VALID_OPERATORS).toContain(rule.operator);
      }
    }
  });
});
