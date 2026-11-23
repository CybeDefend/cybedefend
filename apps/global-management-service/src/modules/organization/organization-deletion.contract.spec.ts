import * as path from 'node:path';
import { loadSync } from '@grpc/proto-loader';

/**
 * The wire contract of the organization deletion confirmation:
 * only the creator deletes an organization, with a 6-digit code e-mailed to
 * them. Read from libs/protos as every consumer generates it, so a renumbered
 * field (a silent wire break between a gateway and a global-management
 * deployed at different times) fails here.
 */

const PROTOS = path.resolve(__dirname, '../../../../../libs/protos');
const PKG = 'cybedefend.global_management';

const definition = loadSync('global-management/global_management.proto', {
  includeDirs: [PROTOS],
  keepCase: true,
});

type FieldDescriptor = { name: string; number: number; type: string };
type MethodDescriptor = {
  requestType: { type: { name: string } };
  responseType: { type: { name: string } };
};

const fieldsOf = (message: string) => {
  const descriptor = definition[`${PKG}.${message}`] as
    | { type: { field: FieldDescriptor[] } }
    | undefined;
  if (!descriptor) throw new Error(`${message} is not declared`);
  return Object.fromEntries(
    descriptor.type.field.map((f) => [f.name, [f.number, f.type]]),
  );
};

const signature = (method: string) => {
  const service = definition[`${PKG}.OrganizationService`] as unknown as
    | Record<string, MethodDescriptor>
    | undefined;
  const m = service?.[method];
  return m && [m.requestType.type.name, m.responseType.type.name];
};

describe('organization deletion confirmation: global-management wire contract', () => {
  it('Delete keeps its former shape: global-management refuses every call', () => {
    expect(signature('Delete')).toEqual([
      'OrganizationDeleteRequest',
      'OrganizationDeleteResponse',
    ]);
    expect(fieldsOf('OrganizationDeleteRequest')).toEqual({
      organizationId: [1, 'TYPE_STRING'],
    });
  });

  // A new RPC, not new fields on Delete: an older global-management answers
  // it UNIMPLEMENTED, where it would have ignored the fields and deleted.
  it('ConfirmOrganizationDeletion names who asks and carries the code', () => {
    expect(signature('ConfirmOrganizationDeletion')).toEqual([
      'ConfirmOrganizationDeletionRequest',
      'OrganizationDeleteResponse',
    ]);
    expect(fieldsOf('ConfirmOrganizationDeletionRequest')).toEqual({
      organizationId: [1, 'TYPE_STRING'],
      requestedBy: [2, 'TYPE_STRING'],
      confirmationCode: [3, 'TYPE_STRING'],
    });
  });

  it('RequestOrganizationDeletionCode sends the code and answers its expiry', () => {
    expect(signature('RequestOrganizationDeletionCode')).toEqual([
      'RequestOrganizationDeletionCodeRequest',
      'RequestOrganizationDeletionCodeResponse',
    ]);
    expect(fieldsOf('RequestOrganizationDeletionCodeRequest')).toEqual({
      organizationId: [1, 'TYPE_STRING'],
      requestedBy: [2, 'TYPE_STRING'],
    });
    expect(fieldsOf('RequestOrganizationDeletionCodeResponse')).toEqual({
      expiresAt: [1, 'TYPE_STRING'],
    });
  });
});
