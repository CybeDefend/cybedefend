import { RpcException } from '@nestjs/microservices';
import { status } from '@grpc/grpc-js';

import { CommunityProjectSettings } from 'src/edition/community/project-settings.community';
import { ProjectService } from './project.service';

/**
 * A Community project is an AppSec project with the AppSec scan settings:
 * the answers carry no setting of a closed feature (the AI-BOM scan, the AI
 * settings, the AppSec mark), and AppSec is the only product a project is
 * created from. The other closed columns are checked in
 * project.service.spec.ts.
 */
const CLOSED_FIELDS = [
  'aibomEnabled',
  'aiMergeRequestEnabled',
  'improvingResultsEnabled',
  'sortsVulnerabilitiesEnabled',
  'appsecEnabled',
];

function communityService(extra: Record<string, unknown> = {}): any {
  return Object.assign(Object.create(ProjectService.prototype), {
    projectSettings: new CommunityProjectSettings(),
    ...extra,
  });
}

const PROJECT: any = {
  id: 'p-1',
  name: 'demo',
  team: { id: 't', name: 'team', organization: { id: 'o', name: 'org' } },
  aibomEnabled: true,
  aiMergeRequestEnabled: true,
  improvingResultsEnabled: true,
  sortsVulnerabilitiesEnabled: true,
  appsecEnabledAt: new Date('2026-10-01'),
  sastEnabled: true,
};

describe('ProjectService (community settings)', () => {
  it('answers a project with no closed setting', () => {
    const answer = communityService().mapToGrpcProject(PROJECT);
    expect(answer.sastEnabled).toBe(true);
    for (const field of CLOSED_FIELDS) expect(answer).not.toHaveProperty(field);
  });

  it('refuses any product but AppSec on creation', async () => {
    const error = await communityService()
      .createProject({ name: 'x', teamId: 't', product: 'closed-product' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(RpcException);
    expect((error as RpcException).getError()).toEqual({
      code: status.INVALID_ARGUMENT,
      message: 'product must be appsec',
    });
  });
});
