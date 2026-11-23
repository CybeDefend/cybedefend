// src/global-management/team/response/team-add-user-response.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty, IsObject } from 'class-validator';
import { TeamInformationsResponseDto } from './team-informations-response.dto';

export class TeamAddUserResponseDto {
  @ApiProperty({ description: 'Message describing the result', type: 'string' })
  @IsNotEmpty()
  @IsString()
  readonly message: string;

  @ApiProperty({
    description: 'Updated team information',
    type: () => TeamInformationsResponseDto,
  })
  @IsObject()
  readonly updatedTeam: TeamInformationsResponseDto;

  constructor(message: string, updatedTeam: TeamInformationsResponseDto) {
    this.message = message;
    this.updatedTeam = updatedTeam;
  }

  public toString(): string {
    return JSON.stringify({
      message: this.message,
      updatedTeam: this.updatedTeam,
    });
  }
}
