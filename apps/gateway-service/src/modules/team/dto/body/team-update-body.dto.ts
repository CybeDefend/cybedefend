// src/global-management/team/body/team-update-request.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import {
  TEAM_TEXT_MAX_LENGTH,
  TeamDescriptionField,
  TeamNameField,
} from './team-text-fields';

export class TeamUpdateBodyDto {
  @ApiProperty({
    description: 'New team name',
    type: 'string',
    maxLength: TEAM_TEXT_MAX_LENGTH,
  })
  @TeamNameField()
  readonly name: string;

  @ApiProperty({
    description: 'New team description',
    type: 'string',
    maxLength: TEAM_TEXT_MAX_LENGTH,
  })
  @TeamDescriptionField()
  readonly description: string;

  constructor(name: string, description: string) {
    this.name = name;
    this.description = description;
  }

  public toString(): string {
    return JSON.stringify({
      name: this.name,
      description: this.description,
    });
  }
}
