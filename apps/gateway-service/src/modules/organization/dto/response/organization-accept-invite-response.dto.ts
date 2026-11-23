import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNotEmpty } from 'class-validator';
import { OrganizationInformationsResponseDto } from './organization-informations-response.dto';

export class OrganizationAcceptInviteResponseDto {
  @ApiProperty({ description: 'Success message', type: 'string' })
  @IsString()
  message: string;

  @ApiProperty({
    description: 'Organization informations',
    type: () => OrganizationInformationsResponseDto,
  })
  @IsNotEmpty()
  organization: OrganizationInformationsResponseDto;

  constructor(
    message: string,
    organization: OrganizationInformationsResponseDto,
  ) {
    this.message = message;
    this.organization = organization;
  }

  public toString(): string {
    return JSON.stringify(this);
  }
}
