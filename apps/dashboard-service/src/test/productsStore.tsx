import React from 'react';
import { Provider } from 'react-redux';
import { configureStore } from '@reduxjs/toolkit';
import { PRODUCTS } from '@/utils/product';

/**
 * A store holding only the selected organisation and its products, for tests
 * that render the product guard (route tables, the switch). Without
 * `products` the list is unknown, which the guard lets through: the route
 * tables keep testing their routes and nothing else.
 */
export const withProducts = (
  node: React.ReactNode,
  products: ReadonlyArray<{ product: string; status: string }> = [],
  /** Overrides of the selected organisation: the role, the member's own products (`myProducts`, `myProductsKnown`). */
  member: Record<string, unknown> = {},
): React.ReactElement => {
  const organization = { selectedOrganization: { id: 'org-1', myRole: 'creator', subscription: null, products, ...member } };
  const store = configureStore({ reducer: { organization: (state: object = organization) => state } });
  return <Provider store={store}>{node}</Provider>;
};

/** The organisation's products in the given states: AppSec first, then every other registered space. */
export const productStates = (appsec: string, other?: string) => [
  { product: 'appsec', status: appsec },
  ...PRODUCTS.filter((product) => product !== 'appsec').map((product) => ({ product, status: other ?? appsec })),
];
