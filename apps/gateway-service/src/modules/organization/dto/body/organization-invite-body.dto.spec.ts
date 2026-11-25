import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { GLOBAL_VALIDATION_PIPE_OPTIONS } from 'src/core/validation/global-validation-pipe-options';
import {
  INVITATION_MAX_TEAM_ASSIGNMENTS,
  OrganizationInviteBodyDto,
} from './organization-invite-body.dto';

const pipe = new ValidationPipe(GLOBAL_VALIDATION_PIPE_OPTIONS);
const validate = (body: unknown) =>
  pipe.transform(body, { type: 'body', metatype: OrganizationInviteBodyDto });

/** A distinct version-4 UUID per index. */
const teamId = (i: number) =>
  `550e8400-e29b-41d4-a716-${String(i).padStart(12, '0')}`;
const assignments = (n: number) =>
  Array.from({ length: n }, (_, i) => ({
    teamId: teamId(i),
    role: 'developer',
  }));

describe('OrganizationInviteBodyDto.teamAssignments', () => {
  it('takes up to 50 team assignments, the most the invitation service accepts', async () => {
    expect(INVITATION_MAX_TEAM_ASSIGNMENTS).toBe(50);
    const body = await validate({
      email: 'jane@example.test',
      role: 'member',
      teamAssignments: assignments(50),
    });
    expect(body.teamAssignments).toHaveLength(50);
  });

  it('refuses 51 team assignments with 400', async () => {
    await expect(
      validate({
        email: 'jane@example.test',
        role: 'member',
        teamAssignments: assignments(51),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('refuses a very long list with 400', async () => {
    await expect(
      validate({
        email: 'jane@example.test',
        role: 'member',
        teamAssignments: assignments(10_000),
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('keeps the field optional', async () => {
    await expect(
      validate({ email: 'jane@example.test', role: 'member' }),
    ).resolves.toBeDefined();
  });
});
