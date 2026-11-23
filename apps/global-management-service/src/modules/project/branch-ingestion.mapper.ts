import {
  BranchIngestionStatus,
  ProjectBranchIngestion,
} from 'src/entities/project-branch-ingestion.entity';

/** A branch ingestion record as the gRPC BranchIngestionInfo message. */
export function mapBranchIngestionToGrpc(record: ProjectBranchIngestion): any {
  // Map entity enum to proto enum value
  let statusValue: number;
  switch (record.status) {
    case BranchIngestionStatus.PARSING:
      statusValue = 1;
      break;
    case BranchIngestionStatus.PARSED:
      statusValue = 2;
      break;
    case BranchIngestionStatus.FAILED:
      statusValue = 3;
      break;
    default:
      statusValue = 0;
  }

  return {
    id: record.id,
    projectId: record.projectId,
    branch: record.branch,
    lastParsedScanId: record.lastParsedScanId || '',
    lastParsedAt: record.lastParsedAt ? record.lastParsedAt.toISOString() : '',
    status: statusValue,
    createdAt: record.createdAt ? record.createdAt.toISOString() : '',
    updatedAt: record.updatedAt ? record.updatedAt.toISOString() : '',
  };
}
