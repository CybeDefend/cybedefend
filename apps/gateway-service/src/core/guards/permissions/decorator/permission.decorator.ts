import { SetMetadata } from '@nestjs/common';

export const Permission = (permissions: string | string[]) =>
  SetMetadata(
    'permissions',
    Array.isArray(permissions) ? permissions : [permissions],
  );

export const SubjectType = (subjectTypes: string | string[]) =>
  SetMetadata(
    'subjectTypes',
    Array.isArray(subjectTypes) ? subjectTypes : [subjectTypes],
  );
