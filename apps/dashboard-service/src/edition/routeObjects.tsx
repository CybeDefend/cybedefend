import type { ReactElement } from 'react';
import { Route, type RouteObject, type RouteProps } from 'react-router-dom';

/**
 * The routes the closed tree hands to the core (`ACTIVE_EE_ROUTES`) are
 * `RouteObject`s; the core's route table is JSX. This turns the objects into
 * `<Route>` elements, children included, so that App.tsx renders them inside
 * its own `<Routes>`, ranked with the core's routes as if they were written
 * there.
 */
export function routeObjectsToRoutes(routes: RouteObject[], keyPrefix = ''): ReactElement[] {
  return routes.map((route, position) => {
    const key = `${keyPrefix}${position}`;
    const { children, ...rest } = route;
    // An index route has no children: `RouteProps` is a union that says so.
    const props = { ...rest, children: children ? routeObjectsToRoutes(children, `${key}.`) : undefined } as RouteProps;
    return <Route key={key} {...props} />;
  });
}
