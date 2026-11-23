import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min, Max } from 'class-validator';
import { Type } from 'class-transformer';

export class OrganizationGetInvitationsBodyDto {
  @ApiProperty({
    description: 'Page number',
    required: true,
    type: 'number',
    minimum: 1,
  })
  @IsInt()
  @Min(1)
  @Type(() => Number)
  page: number = 1;

  @ApiProperty({
    description: 'Number of items per page',
    required: true,
    type: 'number',
    minimum: 1,
    maximum: 20,
  })
  @IsInt()
  @Min(1)
  @Max(20)
  @Type(() => Number)
  pageSize: number = 15;
}
