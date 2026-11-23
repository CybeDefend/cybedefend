import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { OrganizationAddMemberBodyDto } from './dto/body/organization-add-member-body.dto';
import { OrganizationInviteBodyDto } from './dto/body/organization-invite-body.dto';
import { OrganizationUpdateRoleBodyDto } from './dto/body/organization-update-role-body.dto';
import {
  ASSIGNABLE_ORGANIZATION_ROLES,
  registerAssignableOrganizationRole,
  resetAssignableOrganizationRolesForTests,
} from './organization-roles';

const DTOS = [
  {
    name: 'invite',
    dto: OrganizationInviteBodyDto,
    body: { email: 'a@example.com', teams: [] },
  },
  {
    name: 'add member',
    dto: OrganizationAddMemberBodyDto,
    body: { email: 'a@example.com' },
  },
  {
    name: 'role change',
    dto: OrganizationUpdateRoleBodyDto,
    body: { userId: '3f0e4a4e-6b8a-4c9b-9a51-0a2c1a1c2d3e' },
  },
] as const;

function roleErrors(dto: (typeof DTOS)[number], role: string) {
  const instance = plainToInstance(dto.dto as any, { ...dto.body, role });
  return validateSync(instance as object).filter((e) => e.property === 'role');
}

function swaggerEnum(dto: (typeof DTOS)[number]): unknown {
  return Reflect.getMetadata(
    'swagger/apiModelProperties',
    dto.dto.prototype,
    'role',
  )?.enum;
}

describe('assignable organisation roles', () => {
  afterEach(() => resetAssignableOrganizationRolesForTests());

  it('are the core roles alone', () => {
    expect([...ASSIGNABLE_ORGANIZATION_ROLES]).toEqual([
      'administrator',
      'manager',
      'member',
    ]);
  });

  describe.each(DTOS)('$name body', (dto) => {
    it('accepts a core role and refuses one the edition does not give', () => {
      expect(roleErrors(dto, 'manager')).toEqual([]);
      expect(roleErrors(dto, 'billing_manager')).not.toEqual([]);
    });

    it('documents the core roles only', () => {
      expect(swaggerEnum(dto)).toEqual(['administrator', 'manager', 'member']);
    });

    it('accepts and documents a role an edition registers', () => {
      registerAssignableOrganizationRole('billing_manager');
      expect(roleErrors(dto, 'billing_manager')).toEqual([]);
      expect(swaggerEnum(dto)).toEqual([
        'administrator',
        'manager',
        'billing_manager',
        'member',
      ]);
    });
  });
});
