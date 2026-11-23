import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

/**
 * DTO for updating a security policy.
 * The entire policy (name, scope, priority, rules, exclusions, projectIds/teamIds)
 * is defined in the YAML content.
 */
export class UpdatePolicyBodyDto {
  @ApiProperty({
    description: `Full YAML policy definition. Example:
\`\`\`yaml
version: '1.0'
name: Updated Security Policy
description: Updated description
scope: PROJECT
priority: 15
enabled: true
projectIds:
  - 550e8400-e29b-41d4-a716-446655440000
rules:
  - name: Block Critical
    type: severity
    operator: equals
    value: CRITICAL
    action: block
\`\`\``,
    example: `version: '1.0'
name: Updated Security Policy
scope: PROJECT
priority: 15
enabled: true
projectIds:
  - 550e8400-e29b-41d4-a716-446655440000
rules:
  - name: Block Critical
    type: severity
    operator: equals
    value: CRITICAL
    action: block`,
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100000) // Max 100KB YAML
  yamlContent: string;
}
