import { Test, TestingModule } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { TeamService } from './team.service';
import { grantingCreateQueryRunner } from '../authorization/membership-lock.testing';
import { Team } from 'src/entities/team.entity';
import { Organization } from 'src/entities/organization.entity';
import { Project } from 'src/entities/project.entity';
import { User } from 'src/entities/user.entity';
import { UserTeamMembership } from 'src/entities/user-team-membership.entity';
import { ProjectService } from '../project/project.service';
import { Logger } from 'nestjs-pino';
import { AuthorizationService } from '../authorization/authorization.service';
import {
  createLoggerMock,
  createMockRepository,
  MockType,
} from 'src/test-utils/typeorm-mock.util';
import { RealtimeEventPublisher } from '@cybedefend/realtime-publisher';
import { DataPurgeLedger } from '../data-purge/data-purge.ledger';
import { DataPurgeRunner } from '../data-purge/data-purge.runner';
import { status } from '@grpc/grpc-js';
import { RpcException } from '@nestjs/microservices';
import {
  CapturedStatement,
  CaptureResponder,
  createSqlCaptureDataSource,
  rawRow,
} from 'src/test-utils/sql-capture.util';

describe('TeamService', () => {
  let service: TeamService;
  let teamRepo: MockType<any>;
  let orgRepo: MockType<any>;
  let projRepo: MockType<any>;
  let userRepo: MockType<any>;
  let membershipRepo: MockType<any>;
  let projectService: { deleteProject: jest.Mock };
  let realtimePublisher: { publish: jest.Mock };
  let authorization: Record<string, jest.Mock>;
  let manager: { delete: jest.Mock };
  let dataSource: { transaction: jest.Mock; createQueryRunner: jest.Mock };
  let purgeLedger: { enqueueTeam: jest.Mock };
  let purgeRunner: { kick: jest.Mock };
  let tx: { committed: boolean; rolledBack: boolean };

  beforeEach(async () => {
    teamRepo = createMockRepository<Team>();
    orgRepo = createMockRepository<Organization>();
    projRepo = createMockRepository<Project>();
    userRepo = createMockRepository<User>();
    membershipRepo = createMockRepository<UserTeamMembership>();
    projectService = { deleteProject: jest.fn() };
    realtimePublisher = { publish: jest.fn().mockResolvedValue(undefined) };
    manager = { delete: jest.fn(async () => ({ affected: 1 })) };
    purgeLedger = { enqueueTeam: jest.fn(async () => 'job-t1') };
    purgeRunner = { kick: jest.fn() };
    tx = { committed: false, rolledBack: false };
    dataSource = {
      transaction: jest.fn(async (fn: any) => {
        try {
          const result = await fn(manager);
          tx.committed = true;
          return result;
        } catch (err) {
          tx.rolledBack = true;
          throw err;
        }
      }),
      createQueryRunner: grantingCreateQueryRunner(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TeamService,
        { provide: getRepositoryToken(Team), useValue: teamRepo },
        { provide: getRepositoryToken(Organization), useValue: orgRepo },
        { provide: getRepositoryToken(Project), useValue: projRepo },
        { provide: getRepositoryToken(User), useValue: userRepo },
        {
          provide: getRepositoryToken(UserTeamMembership),
          useValue: membershipRepo,
        },
        { provide: ProjectService, useValue: projectService },
        { provide: getDataSourceToken(), useValue: dataSource },
        { provide: DataPurgeLedger, useValue: purgeLedger },
        { provide: DataPurgeRunner, useValue: purgeRunner },
        {
          provide: AuthorizationService,
          useValue: {
            addTeamInOrganization: jest.fn().mockResolvedValue(undefined),
            teamAddMember: jest.fn().mockResolvedValue(undefined),
            removeTeamFromOrganization: jest.fn().mockResolvedValue(undefined),
            removeMemberFromTeam: jest.fn().mockResolvedValue(undefined),
            teamUpdateMemberRole: jest.fn().mockResolvedValue(undefined),
          },
        },
        { provide: Logger, useValue: createLoggerMock() },
        { provide: RealtimeEventPublisher, useValue: realtimePublisher },
      ],
    }).compile();

    service = module.get<TeamService>(TeamService);
    authorization = module.get(AuthorizationService);
  });

  it('createTeam creates and assigns creator', async () => {
    teamRepo.findOne!.mockResolvedValue(null);
    orgRepo.findOne!.mockResolvedValue({ id: 'o1' });
    teamRepo.count!.mockResolvedValue(0);
    userRepo.findOne!.mockResolvedValue({ id: 'u1' });
    teamRepo.save!.mockImplementation(async (t: any) => ({ id: 't1', ...t }));
    membershipRepo.save!.mockResolvedValue({ id: 'mem1' });

    const res = await service.createTeam({
      organizationId: 'o1',
      name: 'T',
      description: 'D',
      creatorId: 'u1',
    } as any);
    expect(res.teamId).toBe('t1');
    expect(membershipRepo.save).toHaveBeenCalled();
  });

  it('getTeam returns team info', async () => {
    teamRepo.findOne!.mockResolvedValue({
      id: 't1',
      name: 'T',
      description: 'D',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const res = await service.getTeam({
      teamId: 't1',
      organizationId: 'o1',
    } as any);
    expect(res.id).toBe('t1');
  });

  it('getAllTeams privileged lists all', async () => {
    // The organization exists, and the caller's privilege is an
    // EXISTS; the list is a QueryBuilder read.
    orgRepo.exists = jest.fn().mockResolvedValue(true);
    (orgRepo.createQueryBuilder!() as any).getExists = jest
      .fn()
      .mockResolvedValue(true);
    (teamRepo.createQueryBuilder!() as any).getMany.mockResolvedValue([
      { id: 't1', name: 'A' },
    ]);
    const res = await service.getAllTeams({
      organizationId: 'o1',
      userId: 'u1',
    } as any);
    expect(res.teams.length).toBe(1);
  });

  it('updateTeam updates name/description', async () => {
    teamRepo.findOne!.mockResolvedValue({
      id: 't1',
      name: 'A',
      description: 'B',
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    teamRepo.save!.mockImplementation(async (t: any) => t);
    const res = await service.updateTeam({
      teamId: 't1',
      name: 'N',
      description: 'D',
    } as any);
    expect(res.updatedTeam?.name).toBe('N');
  });

  it('addMember succeeds when org member', async () => {
    teamRepo.findOne!.mockResolvedValue({
      id: 't1',
      name: 'A',
      description: 'B',
      organization: { id: 'o1' },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    userRepo.findOne!.mockResolvedValue({ id: 'u2' });
    membershipRepo.findOne!.mockResolvedValue(null);
    orgRepo.createQueryBuilder!.mockReturnValue({
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(1),
    });
    membershipRepo.save!.mockResolvedValue({ id: 'm1', role: 'developer' });
    const res = await service.addMember({
      teamId: 't1',
      userId: 'u2',
      role: 'developer',
    } as any);
    expect(res.message).toContain('successfully');
  });

  it('removeMember removes when not last and not manager', async () => {
    membershipRepo.findOne!.mockResolvedValue({
      id: 'm2',
      role: 'developer',
      team: { id: 't1', userMemberships: [{}, {}] },
    });
    const res = await service.removeMember({
      teamId: 't1',
      userId: 'u2',
    } as any);
    expect(res.message).toContain('successfully');
  });

  describe('deleteTeam records a purge job', () => {
    const givenTeam = () => {
      teamRepo.findOne!.mockResolvedValue({
        id: 't1',
        name: 'A',
        organization: { id: 'o1' },
        projects: [{ id: 'p1' }, { id: 'p2' }],
        userMemberships: [{}, {}],
      });
      teamRepo.count!.mockResolvedValue(2);
    };

    it('deletes each project through deleteProject, then the team and its job in one transaction', async () => {
      givenTeam();

      const res = await service.deleteTeam({ teamId: 't1' } as any);

      expect(res.message).toContain('successfully');
      // One project job each, written by deleteProject.
      expect(projectService.deleteProject.mock.calls).toEqual([
        [{ projectId: 'p1' }],
        [{ projectId: 'p2' }],
      ]);
      expect(dataSource.transaction).toHaveBeenCalledTimes(1);
      expect(tx.committed).toBe(true);
      expect(manager.delete).toHaveBeenCalledWith(Team, 't1');
      expect(manager.delete).toHaveBeenCalledWith(UserTeamMembership, {
        team: { id: 't1' },
      });
      expect(purgeLedger.enqueueTeam).toHaveBeenCalledWith(manager, {
        teamId: 't1',
        organizationId: 'o1',
      });
      expect(teamRepo.delete).not.toHaveBeenCalled();
      expect(membershipRepo.delete).not.toHaveBeenCalled();
    });

    it('kicks the purge runner with the team job once the transaction is committed', async () => {
      givenTeam();
      // Recorded here, asserted below: the service's own try/catch around
      // the kick would swallow a failing expect.
      let committedAtKick: boolean | null = null;
      purgeRunner.kick.mockImplementation(() => {
        committedAtKick = tx.committed;
      });

      await service.deleteTeam({ teamId: 't1' } as any);

      // The project jobs are kicked by deleteProject itself.
      expect(purgeRunner.kick).toHaveBeenCalledTimes(1);
      // Never inside the transaction: a failing kick cannot undo it.
      expect(committedAtKick).toBe(true);
      expect(purgeRunner.kick).toHaveBeenCalledWith(['job-t1']);
    });

    it('a kick that throws never undoes the team deletion', async () => {
      givenTeam();
      purgeRunner.kick.mockImplementation(() => {
        throw new Error('runner down');
      });

      const res = await service.deleteTeam({ teamId: 't1' } as any);

      expect(res.message).toContain('successfully');
      expect(tx.committed).toBe(true);
    });

    it('a failing job insert rejects the call and keeps the team', async () => {
      givenTeam();
      purgeLedger.enqueueTeam.mockRejectedValue(new Error('ER_LOCK_DEADLOCK'));

      await expect(service.deleteTeam({ teamId: 't1' } as any)).rejects.toThrow(
        'ER_LOCK_DEADLOCK',
      );

      expect(tx.rolledBack).toBe(true);
      expect(purgeRunner.kick).not.toHaveBeenCalled();
      expect(teamRepo.delete).not.toHaveBeenCalled();
    });

    it('a failing Permify removal deletes nothing and enqueues nothing', async () => {
      givenTeam();
      authorization.removeTeamFromOrganization.mockRejectedValueOnce(
        new Error('permify down'),
      );

      await expect(service.deleteTeam({ teamId: 't1' } as any)).rejects.toThrow(
        'permify down',
      );

      expect(dataSource.transaction).not.toHaveBeenCalled();
      expect(manager.delete).not.toHaveBeenCalled();
      expect(purgeLedger.enqueueTeam).not.toHaveBeenCalled();
    });

    it('the last team of an organization is refused and nothing is enqueued', async () => {
      givenTeam();
      teamRepo.count!.mockResolvedValue(1);

      await expect(
        service.deleteTeam({ teamId: 't1' } as any),
      ).rejects.toBeInstanceOf(RpcException);

      expect(projectService.deleteProject).not.toHaveBeenCalled();
      expect(purgeLedger.enqueueTeam).not.toHaveBeenCalled();
    });
  });

  it('removeMember publishes MEMBERSHIP_CHANGED with changeType removed', async () => {
    membershipRepo.findOne!.mockResolvedValue({
      id: 'm2',
      role: 'developer',
      team: {
        id: 't1',
        organization: { id: 'o1' },
        userMemberships: [{}, {}],
      },
    });
    await service.removeMember({ teamId: 't1', userId: 'u2' } as any);
    expect(realtimePublisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'MEMBERSHIP_CHANGED',
        scope: expect.objectContaining({
          organizationId: 'o1',
          teamId: 't1',
          userId: 'u2',
        }),
        payload: expect.objectContaining({
          membershipChanged: expect.objectContaining({
            changeType: 'removed',
            scopeType: 'team',
          }),
        }),
      }),
    );
  });

  it('updateMemberRole on team publishes MEMBERSHIP_CHANGED with changeType role_changed', async () => {
    membershipRepo.findOne!.mockResolvedValue({
      id: 'm3',
      role: 'developer',
      team: {
        id: 't1',
        organization: { id: 'o1' },
        userMemberships: [{}, {}],
      },
    });
    membershipRepo.save!.mockImplementation(async (m: any) => m);
    await service.updateMemberRole({
      teamId: 't1',
      userId: 'u2',
      role: 'reviewer',
    } as any);
    expect(realtimePublisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'MEMBERSHIP_CHANGED',
        scope: expect.objectContaining({
          organizationId: 'o1',
          teamId: 't1',
          userId: 'u2',
        }),
        payload: expect.objectContaining({
          membershipChanged: expect.objectContaining({
            changeType: 'role_changed',
            scopeType: 'team',
          }),
        }),
      }),
    );
  });

  it('addMember publishes MEMBERSHIP_CHANGED with changeType added', async () => {
    teamRepo.findOne!.mockResolvedValue({
      id: 't1',
      name: 'A',
      description: 'B',
      organization: { id: 'o1' },
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    userRepo.findOne!.mockResolvedValue({ id: 'u2' });
    membershipRepo.findOne!.mockResolvedValue(null);
    orgRepo.createQueryBuilder!.mockReturnValue({
      innerJoin: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(1),
    });
    membershipRepo.save!.mockResolvedValue({ id: 'm1', role: 'developer' });
    await service.addMember({
      teamId: 't1',
      userId: 'u2',
      role: 'developer',
    } as any);
    expect(realtimePublisher.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'MEMBERSHIP_CHANGED',
        scope: expect.objectContaining({
          organizationId: 'o1',
          teamId: 't1',
          userId: 'u2',
        }),
        payload: expect.objectContaining({
          membershipChanged: expect.objectContaining({
            changeType: 'added',
            scopeType: 'team',
          }),
        }),
      }),
    );
  });
  // GetAllTeams loaded every membership of the
  // organization, with its user, to decide whether the caller is privileged,
  // and the team members were loaded whole then paginated in JS. These tests
  // run the real TypeORM SQL against a recording query runner.
  describe('reads in O(page)', () => {
    let statements: CapturedStatement[];
    let setResponder: (next: CaptureResponder) => void;
    const member = (n: number) => ({
      membership_id: `m${n}`,
      membership_role: 'developer',
      user_id: `u${n}`,
      user_firstName: `First${n}`,
      user_lastName: `Last${n}`,
      user_email: `u${n}@example.test`,
      user_picture: '',
    });
    // An EXISTS answers a row when it holds.
    const exists = (holds: boolean) => (holds ? [{ row_exists: '1' }] : []);
    const respond =
      ({
        organization = true,
        privileged = true,
        team = true,
        members = [] as Record<string, unknown>[],
        total = members.length,
      } = {}): CaptureResponder =>
      ({ sql }) => {
        if (/^SELECT 1 AS `row_exists`/.test(sql)) {
          if (/users_organizations_members/.test(sql))
            return exists(privileged);
          if (/FROM `organization`/.test(sql)) return exists(organization);
          if (/FROM `team`/.test(sql)) return exists(team);
          return [];
        }
        if (/COUNT\(DISTINCT/.test(sql)) return [{ cnt: String(total) }];
        if (/FROM `teams_members`/.test(sql)) return members;
        if (/FROM `team` `team`/.test(sql))
          return [
            rawRow(sql, {
              team_id: 't1',
              team_name: 'Alpha',
              team_description: '',
            }),
          ];
        // The reads these tests replace (findOne with relations): its
        // DISTINCT pre-query, then one row of the entity and its relations,
        // every id being the caller's.
        if (/^SELECT DISTINCT `distinctAlias`/.test(sql))
          return [
            rawRow(sql, { ids_Organization_id: 'o1', ids_Team_id: 't1' }),
          ];
        return [
          rawRow(sql, {
            Organization_id: 'o1',
            Team_id: 't1',
            id: 'u1',
            role: 'creator',
            name: 'Alpha',
            description: '',
            firstName: 'First1',
            lastName: 'Last1',
            email: 'u1@example.test',
            picture: '',
          }),
        ];
      };

    beforeEach(async () => {
      const capture = await createSqlCaptureDataSource(respond());
      statements = capture.statements;
      setResponder = capture.setResponder;
      for (const [repo, entity] of [
        [teamRepo, Team],
        [orgRepo, Organization],
        [membershipRepo, UserTeamMembership],
      ] as const) {
        const real = capture.dataSource.getRepository(entity);
        repo.find = jest.fn((options) => real.find(options));
        repo.findOne = jest.fn((options) => real.findOne(options));
        repo.createQueryBuilder = jest.fn((alias?: string) =>
          real.createQueryBuilder(alias),
        );
        repo.exists = jest.fn((options) => real.exists(options));
      }
    });

    it("getAllTeams decides the caller's privilege with an EXISTS, without loading the organization's members", async () => {
      const res = await service.getAllTeams({
        organizationId: 'o1',
        userId: 'u1',
      } as any);

      expect(statements.some((s) => /`user`/.test(s.sql))).toBe(false);
      const privilege = statements.find((s) =>
        /users_organizations_members/.test(s.sql),
      );
      expect(privilege.sql).toMatch(/^SELECT 1 AS `row_exists`/);
      expect(privilege.params).toEqual(
        expect.arrayContaining(['o1', 'u1', 'creator', 'administrator']),
      );
      const list = statements.find((s) => /^SELECT `team`/.test(s.sql));
      expect(list.sql).toMatch(
        /ORDER BY `team`\.`name` ASC, `team`\.`id` ASC$/,
      );
      expect(res.teams.map((t) => t.id)).toEqual(['t1']);
    });

    it('getAllTeams lists only the teams of a non-privileged caller, in the same order', async () => {
      setResponder(respond({ privileged: false }));

      await service.getAllTeams({ organizationId: 'o1', userId: 'u1' } as any);

      const list = statements.find((s) => /^SELECT `team`/.test(s.sql));
      expect(list.sql).toMatch(/INNER JOIN `teams_members`/);
      expect(list.params).toEqual(['o1', 'u1']);
      expect(list.sql).toMatch(
        /ORDER BY `team`\.`name` ASC, `team`\.`id` ASC$/,
      );
    });

    it('getAllTeams still answers NOT_FOUND for an unknown organization', async () => {
      setResponder(respond({ organization: false, privileged: false }));

      const thrown = await service
        .getAllTeams({ organizationId: 'nope', userId: 'u1' } as any)
        .catch((e) => e);

      expect(thrown.getError()).toEqual({
        code: status.NOT_FOUND,
        message: 'Organization not found',
      });
    });

    it('getMembers reads one page in SQL and the total from a COUNT', async () => {
      setResponder(respond({ members: [member(6), member(7)], total: 12 }));

      const res = await service.getMembers({
        teamId: 't1',
        page: 2,
        pageSize: 5,
        searchQuery: '',
      } as any);

      const page = statements.find(
        (s) => /FROM `teams_members`/.test(s.sql) && !/COUNT/.test(s.sql),
      );
      expect(page.sql).not.toMatch(/DISTINCT/);
      expect(page.sql).toMatch(
        /ORDER BY `membership`\.`userId` ASC, `membership`\.`id` ASC LIMIT 5 OFFSET 5$/,
      );
      expect(page.params).toEqual(['t1']);
      expect(res).toEqual({
        users: [
          {
            id: 'u6',
            firstName: 'First6',
            lastName: 'Last6',
            email: 'u6@example.test',
            picture: '',
            role: 'developer',
          },
          {
            id: 'u7',
            firstName: 'First7',
            lastName: 'Last7',
            email: 'u7@example.test',
            picture: '',
            role: 'developer',
          },
        ],
        totalUsers: 12,
        totalPages: 3,
      });
    });

    it('getMembers searches first name, last name and e-mail with LIKE, its wildcards escaped', async () => {
      await service.getMembers({
        teamId: 't1',
        page: 1,
        pageSize: 15,
        searchQuery: '50%_off\\',
      } as any);

      const page = statements.find(
        (s) => /FROM `teams_members`/.test(s.sql) && !/COUNT/.test(s.sql),
      );
      expect(page.sql).not.toMatch(/UPPER|LOWER/);
      expect(page.sql.match(/ LIKE \?/g)).toHaveLength(3);
      // One pattern per searched column.
      const pattern = '%50\\%\\_off\\\\%';
      expect(page.params).toEqual(['t1', pattern, pattern, pattern]);
    });

    it('getMembers still answers NOT_FOUND for an unknown team', async () => {
      setResponder(respond({ team: false }));

      const thrown = await service
        .getMembers({ teamId: 'nope', page: 1, pageSize: 15 } as any)
        .catch((e) => e);

      expect(thrown.getError()).toEqual({
        code: status.NOT_FOUND,
        message: 'Team not found',
      });
    });

    it('getMember reads the one membership, with its user', async () => {
      setResponder(respond({ members: [member(3)] }));

      const res = await service.getMember({
        teamId: 't1',
        userId: 'u3',
      } as any);

      expect(statements).toHaveLength(1);
      expect(statements[0].sql).toMatch(/FROM `teams_members`/);
      expect(statements[0].params).toEqual(['t1', 'u3']);
      expect(res).toMatchObject({ id: 'u3', email: 'u3@example.test' });
    });

    it('getMember tells an unknown team from a user outside the team', async () => {
      setResponder(respond({ members: [] }));
      const outside = await service
        .getMember({ teamId: 't1', userId: 'u3' } as any)
        .catch((e) => e);
      expect(outside.getError()).toEqual({
        code: status.NOT_FOUND,
        message: 'User not in team',
      });

      setResponder(respond({ members: [], team: false }));
      const unknown = await service
        .getMember({ teamId: 'nope', userId: 'u3' } as any)
        .catch((e) => e);
      expect(unknown.getError()).toEqual({
        code: status.NOT_FOUND,
        message: 'Team not found',
      });
    });
  });

  // A removed member must not keep reading the team's projects through a
  // team tuple whose deletion failed: the team row stays until the tuple is
  // gone.
  describe('forceRemoveMemberFromTeams leaves no team tuple behind', () => {
    const memberships = [
      { id: 'tm1', role: 'developer', team: { id: 't1' } },
      { id: 'tm2', role: 'team_manager', team: { id: 't2' } },
    ];
    const removeFromBoth = () =>
      service.forceRemoveMemberFromTeams({
        userId: 'u2',
        teamIds: ['t1', 't2'],
      });

    beforeEach(() => {
      membershipRepo.find!.mockResolvedValue(memberships);
      membershipRepo.remove!.mockResolvedValue(undefined);
    });

    it('deletes every team tuple, then the team rows', async () => {
      await expect(removeFromBoth()).resolves.toMatchObject({
        removedCount: 2,
      });

      expect(authorization.removeMemberFromTeam).toHaveBeenCalledWith({
        teamId: 't1',
        userId: 'u2',
      });
      expect(authorization.removeMemberFromTeam).toHaveBeenCalledWith({
        teamId: 't2',
        userId: 'u2',
      });
      expect(membershipRepo.remove).toHaveBeenCalledWith(memberships);
      expect(
        Math.max(
          ...authorization.removeMemberFromTeam.mock.invocationCallOrder,
        ),
      ).toBeLessThan(membershipRepo.remove!.mock.invocationCallOrder[0]);
    });

    it('a tuple that is already gone counts as deleted', async () => {
      authorization.removeMemberFromTeam.mockRejectedValueOnce(
        new RpcException({
          code: status.NOT_FOUND,
          message: 'User does not have any role in team',
        }),
      );

      await expect(removeFromBoth()).resolves.toMatchObject({
        removedCount: 2,
      });
      expect(membershipRepo.remove).toHaveBeenCalledWith(memberships);
    });

    it('a failed tuple deletion fails the call, keeps every team row, and writes back the tuples it deleted', async () => {
      authorization.removeMemberFromTeam.mockImplementation(
        async ({ teamId }: { teamId: string }) => {
          if (teamId === 't2') throw new Error('14 UNAVAILABLE');
          return { message: 'removed' };
        },
      );

      const thrown = await removeFromBoth().catch((e: unknown) => e);

      expect(thrown).toBeInstanceOf(RpcException);
      expect((thrown as RpcException).getError()).toEqual({
        code: status.UNAVAILABLE,
        message: 'Team access not removed, retry',
      });
      expect(membershipRepo.remove).not.toHaveBeenCalled();
      // t1's tuple was deleted: put back, so the rows and Permify agree.
      expect(authorization.teamAddMember).toHaveBeenCalledWith({
        teamId: 't1',
        userId: 'u2',
        role: 'developer',
      });
      expect(authorization.teamAddMember).toHaveBeenCalledTimes(1);
    });
  });
});
