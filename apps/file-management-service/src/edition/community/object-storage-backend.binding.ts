import type { Provider } from '@nestjs/common';
import { OBJECT_STORAGE_BACKEND } from '../ports/object-storage-backend.port';

// The Community Edition stores objects in its S3-compatible store, which
// FileService drives itself: no other backend is bound.
export const OBJECT_STORAGE_BACKEND_COMMUNITY_BINDINGS: Provider[] = [
  { provide: OBJECT_STORAGE_BACKEND, useValue: null },
];
