import { ApiProperty } from '@nestjs/swagger';
import { IsArray, IsString, ArrayMaxSize, Matches } from 'class-validator';

export class SyncJiraStatusBodyDto {
  @ApiProperty({
    description: 'Jira issue keys to sync',
    type: [String],
    example: ['TRI-142', 'TRI-143'],
  })
  @IsArray()
  @IsString({ each: true })
  @ArrayMaxSize(50)
  @Matches(/^[A-Z][A-Z0-9_]+-\d+$/, { each: true })
  externalIssueKeys: string[];
}
