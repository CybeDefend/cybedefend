import { randomUUID } from 'node:crypto';
import { InMemoryOrganizationDeletionCodeStore } from 'src/test-utils/in-memory-organization-deletion-code-store';
import { describeOrganizationDeletionCodeStoreContract } from './organization-deletion-code.store.contract';

/**
 * The in-memory double the unit specs use, held to the contract the MySQL
 * store passes on a real MySQL (`organization-deletion-code.store.live.spec.ts`).
 */
describe('InMemoryOrganizationDeletionCodeStore (the double of the MySQL store)', () => {
  describeOrganizationDeletionCodeStoreContract(async () => ({
    store: new InMemoryOrganizationDeletionCodeStore(),
    organizationId: randomUUID(),
    userId: randomUUID(),
  }));
});
