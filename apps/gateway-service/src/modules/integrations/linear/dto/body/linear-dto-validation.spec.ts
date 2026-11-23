import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { LinearCallbackInstallBodyDto } from './linear-callback-install-body.dto';
import { SetLinearConfigBodyDto } from './set-linear-config-body.dto';
import { CreateLinearIssuesBodyDto } from './create-linear-issues-body.dto';
import { LinkLinearIssueBodyDto } from './link-linear-issue-body.dto';

const UUID_A = '8f14e45f-ceea-467a-9575-1ae4b1c3d2a1';
const UUID_B = '2c9d1b0e-47aa-4b61-8c52-7de3f2a90b14';

async function failingProperties(
  dto: object,
  property?: string,
): Promise<string[]> {
  const errors = await validate(dto);
  return errors
    .map((e) => e.property)
    .filter((p) => property === undefined || p === property);
}

describe('Linear DTO validation hardening', () => {
  // ---------- LinearCallbackInstallBodyDto ----------

  describe('LinearCallbackInstallBodyDto', () => {
    const valid = {
      code: 'abc123def456',
      redirectUri: 'https://app.example.com/integrations/linear/callback',
      state: 'a'.repeat(64),
    };

    it('accepts a valid callback body', async () => {
      const dto = plainToInstance(LinearCallbackInstallBodyDto, valid);
      expect(await validate(dto)).toHaveLength(0);
    });

    it('refuses a code longer than 2048 characters', async () => {
      const dto = plainToInstance(LinearCallbackInstallBodyDto, {
        ...valid,
        code: 'a'.repeat(2049),
      });
      expect(await failingProperties(dto, 'code')).toEqual(['code']);
    });

    it('refuses a non-HTTPS redirectUri', async () => {
      const dto = plainToInstance(LinearCallbackInstallBodyDto, {
        ...valid,
        redirectUri: 'http://app.example.com/integrations/linear/callback',
      });
      expect(await failingProperties(dto, 'redirectUri')).toEqual([
        'redirectUri',
      ]);
    });

    it('refuses a missing state', async () => {
      const dto = plainToInstance(LinearCallbackInstallBodyDto, {
        ...valid,
        state: undefined,
      });
      expect(await failingProperties(dto, 'state')).toEqual(['state']);
    });

    it('refuses a state longer than 512 characters', async () => {
      const dto = plainToInstance(LinearCallbackInstallBodyDto, {
        ...valid,
        state: 's'.repeat(513),
      });
      expect(await failingProperties(dto, 'state')).toEqual(['state']);
    });
  });

  // ---------- SetLinearConfigBodyDto ----------

  describe('SetLinearConfigBodyDto', () => {
    it('accepts the team alone', async () => {
      const dto = plainToInstance(SetLinearConfigBodyDto, { teamId: UUID_A });
      expect(await validate(dto)).toHaveLength(0);
    });

    it('accepts every optional field', async () => {
      const dto = plainToInstance(SetLinearConfigBodyDto, {
        teamId: UUID_A,
        linearProjectId: UUID_B,
        labelIds: [UUID_A, UUID_B],
        allowedBranches: ['main', 'develop'],
        autoCreateEnabled: true,
      });
      expect(await validate(dto)).toHaveLength(0);
    });

    it('refuses a teamId that is not a UUID', async () => {
      const dto = plainToInstance(SetLinearConfigBodyDto, {
        teamId: 'ENG',
      });
      expect(await failingProperties(dto, 'teamId')).toEqual(['teamId']);
    });

    it('refuses a missing teamId', async () => {
      const dto = plainToInstance(SetLinearConfigBodyDto, {});
      expect(await failingProperties(dto, 'teamId')).toEqual(['teamId']);
    });

    it('refuses a linearProjectId that is not a UUID', async () => {
      const dto = plainToInstance(SetLinearConfigBodyDto, {
        teamId: UUID_A,
        linearProjectId: 'not-a-uuid',
      });
      expect(await failingProperties(dto, 'linearProjectId')).toEqual([
        'linearProjectId',
      ]);
    });

    it('refuses a labelId that is not a UUID', async () => {
      const dto = plainToInstance(SetLinearConfigBodyDto, {
        teamId: UUID_A,
        labelIds: [UUID_A, 'bug'],
      });
      expect(await failingProperties(dto, 'labelIds')).toEqual(['labelIds']);
    });

    it('refuses more than 20 labelIds', async () => {
      const dto = plainToInstance(SetLinearConfigBodyDto, {
        teamId: UUID_A,
        labelIds: Array.from({ length: 21 }, () => UUID_A),
      });
      expect(await failingProperties(dto, 'labelIds')).toEqual(['labelIds']);
    });

    it('accepts exactly 20 labelIds', async () => {
      const dto = plainToInstance(SetLinearConfigBodyDto, {
        teamId: UUID_A,
        labelIds: Array.from({ length: 20 }, () => UUID_A),
      });
      expect(await validate(dto)).toHaveLength(0);
    });

    it('refuses more than 50 allowedBranches', async () => {
      const dto = plainToInstance(SetLinearConfigBodyDto, {
        teamId: UUID_A,
        allowedBranches: Array.from({ length: 51 }, (_, i) => `branch-${i}`),
      });
      expect(await failingProperties(dto, 'allowedBranches')).toEqual([
        'allowedBranches',
      ]);
    });

    it('refuses a branch name longer than 255 characters', async () => {
      const dto = plainToInstance(SetLinearConfigBodyDto, {
        teamId: UUID_A,
        allowedBranches: ['a'.repeat(256)],
      });
      expect(await failingProperties(dto, 'allowedBranches')).toEqual([
        'allowedBranches',
      ]);
    });

    it('refuses an autoCreateEnabled that is not a boolean', async () => {
      const dto = plainToInstance(SetLinearConfigBodyDto, {
        teamId: UUID_A,
        autoCreateEnabled: 'yes',
      });
      expect(await failingProperties(dto, 'autoCreateEnabled')).toEqual([
        'autoCreateEnabled',
      ]);
    });
  });

  // ---------- CreateLinearIssuesBodyDto ----------

  describe('CreateLinearIssuesBodyDto', () => {
    const valid = {
      mode: 1,
      vulnerabilities: [
        {
          vulnerabilityId: 'vuln-1',
          scannerType: 'sast',
          severity: 'high',
          name: 'SQL Injection',
        },
      ],
      cybedefendBaseUrl: 'https://app.example.com',
    };

    it('accepts the Jira-shaped body without any Linear field', async () => {
      const dto = plainToInstance(CreateLinearIssuesBodyDto, valid);
      expect(await validate(dto)).toHaveLength(0);
    });

    it('accepts every per-ticket choice', async () => {
      const dto = plainToInstance(CreateLinearIssuesBodyDto, {
        ...valid,
        teamId: UUID_A,
        linearProjectId: UUID_B,
        assigneeId: UUID_B,
        labelIds: [UUID_A],
        priority: 2,
      });
      expect(await validate(dto)).toHaveLength(0);
    });

    it('refuses a teamId that is not a UUID', async () => {
      const dto = plainToInstance(CreateLinearIssuesBodyDto, {
        ...valid,
        teamId: 'ENG',
      });
      expect(await failingProperties(dto, 'teamId')).toEqual(['teamId']);
    });

    it('refuses a linearProjectId that is not a UUID', async () => {
      const dto = plainToInstance(CreateLinearIssuesBodyDto, {
        ...valid,
        linearProjectId: 'roadmap',
      });
      expect(await failingProperties(dto, 'linearProjectId')).toEqual([
        'linearProjectId',
      ]);
    });

    it('refuses an assigneeId that is not a UUID', async () => {
      const dto = plainToInstance(CreateLinearIssuesBodyDto, {
        ...valid,
        assigneeId: 'jane',
      });
      expect(await failingProperties(dto, 'assigneeId')).toEqual([
        'assigneeId',
      ]);
    });

    it('refuses a priority of 5', async () => {
      const dto = plainToInstance(CreateLinearIssuesBodyDto, {
        ...valid,
        priority: 5,
      });
      expect(await failingProperties(dto, 'priority')).toEqual(['priority']);
    });

    it('refuses a negative priority', async () => {
      const dto = plainToInstance(CreateLinearIssuesBodyDto, {
        ...valid,
        priority: -1,
      });
      expect(await failingProperties(dto, 'priority')).toEqual(['priority']);
    });

    it('refuses a fractional priority', async () => {
      const dto = plainToInstance(CreateLinearIssuesBodyDto, {
        ...valid,
        priority: 1.5,
      });
      expect(await failingProperties(dto, 'priority')).toEqual(['priority']);
    });

    it('accepts the priority bounds 0 and 4', async () => {
      for (const priority of [0, 4]) {
        const dto = plainToInstance(CreateLinearIssuesBodyDto, {
          ...valid,
          priority,
        });
        expect(await validate(dto)).toHaveLength(0);
      }
    });

    it('refuses 21 labelIds', async () => {
      const dto = plainToInstance(CreateLinearIssuesBodyDto, {
        ...valid,
        labelIds: Array.from({ length: 21 }, () => UUID_A),
      });
      expect(await failingProperties(dto, 'labelIds')).toEqual(['labelIds']);
    });

    it('refuses a labelId that is not a UUID', async () => {
      const dto = plainToInstance(CreateLinearIssuesBodyDto, {
        ...valid,
        labelIds: ['urgent'],
      });
      expect(await failingProperties(dto, 'labelIds')).toEqual(['labelIds']);
    });

    it('keeps the SSRF guard on cybedefendBaseUrl', async () => {
      for (const cybedefendBaseUrl of [
        'http://app.example.com',
        'https://localhost:3000/app',
        'https://169.254.169.254/metadata',
        'https://10.0.0.1/app',
      ]) {
        const dto = plainToInstance(CreateLinearIssuesBodyDto, {
          ...valid,
          cybedefendBaseUrl,
        });
        expect(await failingProperties(dto, 'cybedefendBaseUrl')).toEqual([
          'cybedefendBaseUrl',
        ]);
      }
    });

    it('validates each vulnerability with the shared VulnerabilityInfoDto', async () => {
      const dto = plainToInstance(CreateLinearIssuesBodyDto, {
        ...valid,
        vulnerabilities: [{ vulnerabilityId: 'vuln-1' }],
      });
      expect(await failingProperties(dto, 'vulnerabilities')).toEqual([
        'vulnerabilities',
      ]);
    });
  });

  // ---------- LinkLinearIssueBodyDto ----------

  describe('LinkLinearIssueBodyDto', () => {
    const valid = {
      issueRef: 'ENG-142',
      vulnerabilityIds: ['vuln-1'],
      scannerType: 'sast',
    };

    it('accepts an identifier', async () => {
      const dto = plainToInstance(LinkLinearIssueBodyDto, valid);
      expect(await validate(dto)).toHaveLength(0);
    });

    it('accepts a linear.app issue URL', async () => {
      const dto = plainToInstance(LinkLinearIssueBodyDto, {
        ...valid,
        issueRef: 'https://linear.app/acme/issue/ENG-142/fix-the-thing',
      });
      expect(await validate(dto)).toHaveLength(0);
    });

    it('refuses a javascript: reference', async () => {
      const dto = plainToInstance(LinkLinearIssueBodyDto, {
        ...valid,
        issueRef: 'javascript:alert(1)',
      });
      expect(await failingProperties(dto, 'issueRef')).toEqual(['issueRef']);
    });

    it('refuses an http: linear.app URL', async () => {
      const dto = plainToInstance(LinkLinearIssueBodyDto, {
        ...valid,
        issueRef: 'http://linear.app/acme/issue/ENG-142',
      });
      expect(await failingProperties(dto, 'issueRef')).toEqual(['issueRef']);
    });

    it('refuses a URL on another host, including a look-alike prefix', async () => {
      for (const issueRef of [
        'https://evil.example.com/acme/issue/ENG-142',
        'https://linear.app.evil.example.com/acme/issue/ENG-142',
        'https://linearxapp/acme',
      ]) {
        const dto = plainToInstance(LinkLinearIssueBodyDto, {
          ...valid,
          issueRef,
        });
        expect(await failingProperties(dto, 'issueRef')).toEqual(['issueRef']);
      }
    });

    it('refuses a reference with whitespace or a newline', async () => {
      for (const issueRef of [
        'ENG-142\n',
        'ENG-142 extra',
        'https://linear.app/acme/issue/ENG-142 extra',
      ]) {
        const dto = plainToInstance(LinkLinearIssueBodyDto, {
          ...valid,
          issueRef,
        });
        expect(await failingProperties(dto, 'issueRef')).toEqual(['issueRef']);
      }
    });

    // external-integrations reads an identifier in any case and upper-cases it.
    it('accepts a lower-case or mixed-case identifier', async () => {
      for (const issueRef of ['eng-142', 'Eng-142', 'e2e-7']) {
        const dto = plainToInstance(LinkLinearIssueBodyDto, {
          ...valid,
          issueRef,
        });
        expect(await validate(dto)).toHaveLength(0);
      }
    });

    it('refuses a Jira-style key with an underscore, and a key not starting with a letter', async () => {
      for (const issueRef of ['MY_KEY-1', '2ENG-1', 'ABCDEFGHIJK-1']) {
        const dto = plainToInstance(LinkLinearIssueBodyDto, {
          ...valid,
          issueRef,
        });
        expect(await failingProperties(dto, 'issueRef')).toEqual(['issueRef']);
      }
    });

    it('refuses a URL path longer than 400 characters', async () => {
      const dto = plainToInstance(LinkLinearIssueBodyDto, {
        ...valid,
        issueRef: `https://linear.app/${'a'.repeat(401)}`,
      });
      expect(await failingProperties(dto, 'issueRef')).toEqual(['issueRef']);
    });

    it('refuses more than 500 vulnerabilityIds', async () => {
      const dto = plainToInstance(LinkLinearIssueBodyDto, {
        ...valid,
        vulnerabilityIds: Array.from({ length: 501 }, (_, i) => `v-${i}`),
      });
      expect(await failingProperties(dto, 'vulnerabilityIds')).toEqual([
        'vulnerabilityIds',
      ]);
    });

    it('accepts exactly 500 vulnerabilityIds', async () => {
      const dto = plainToInstance(LinkLinearIssueBodyDto, {
        ...valid,
        vulnerabilityIds: Array.from({ length: 500 }, (_, i) => `v-${i}`),
      });
      expect(await validate(dto)).toHaveLength(0);
    });

    it('refuses a missing scannerType', async () => {
      const dto = plainToInstance(LinkLinearIssueBodyDto, {
        ...valid,
        scannerType: undefined,
      });
      expect(await failingProperties(dto, 'scannerType')).toEqual([
        'scannerType',
      ]);
    });

    it('keeps the SSRF guard on an optional cybedefendBaseUrl', async () => {
      const dto = plainToInstance(LinkLinearIssueBodyDto, {
        ...valid,
        cybedefendBaseUrl: 'https://192.168.1.1/app',
      });
      expect(await failingProperties(dto, 'cybedefendBaseUrl')).toEqual([
        'cybedefendBaseUrl',
      ]);
    });
  });
});
