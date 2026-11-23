import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, MaxLength } from 'class-validator';

/**
 * Policy scope enum for filtering
 */
export enum PolicyScopeDto {
  ORGANIZATION = 'ORGANIZATION',
  TEAM = 'TEAM',
  PROJECT = 'PROJECT',
}

/**
 * DTO for creating a security policy.
 * The entire policy (name, scope, priority, rules, exclusions, projectIds/teamIds)
 * is defined in the YAML content.
 */
export class CreatePolicyBodyDto {
  @ApiProperty({
    description: `Full YAML policy definition. Example:
\`\`\`yaml
version: '1.0'
name: Production Security Policy
description: Block critical vulnerabilities
scope: PROJECT
priority: 10
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
name: Production Security Policy
scope: PROJECT
priority: 10
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
