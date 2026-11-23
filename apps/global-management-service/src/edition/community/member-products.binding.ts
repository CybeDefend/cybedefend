import type { Provider } from '@nestjs/common';
import { MEMBER_PRODUCTS_PORT } from '../ports/member-products.port';
import { CommunityMemberProducts } from './member-products.community';

export const MEMBER_PRODUCTS_COMMUNITY_BINDINGS: Provider[] = [
  { provide: MEMBER_PRODUCTS_PORT, useClass: CommunityMemberProducts },
];
