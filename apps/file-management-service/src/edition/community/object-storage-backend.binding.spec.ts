import { COMMUNITY_BINDINGS } from '../community-bindings';
import { OBJECT_STORAGE_BACKEND } from '../ports/object-storage-backend.port';
import { OBJECT_STORAGE_BACKEND_COMMUNITY_BINDINGS } from './object-storage-backend.binding';

describe('OBJECT_STORAGE_BACKEND community binding', () => {
  it('binds no backend: FileService drives the S3-compatible store', () => {
    expect(OBJECT_STORAGE_BACKEND_COMMUNITY_BINDINGS).toEqual([
      { provide: OBJECT_STORAGE_BACKEND, useValue: null },
    ]);
  });

  it('is one of COMMUNITY_BINDINGS', () => {
    expect(COMMUNITY_BINDINGS).toEqual(
      expect.arrayContaining(OBJECT_STORAGE_BACKEND_COMMUNITY_BINDINGS),
    );
  });
});
