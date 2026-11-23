import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Outlet, Routes } from 'react-router-dom';
import { routeObjectsToRoutes } from './routeObjects';

const routes = [
  { path: '/a', element: <p>A</p> },
  {
    path: '/b',
    element: (
      <div>
        <p>B</p>
        <Outlet />
      </div>
    ),
    children: [{ path: 'c', element: <p>C</p> }],
  },
  { path: '/d', children: [{ index: true, element: <p>D index</p> }] },
];

const renderAt = (entry: string) =>
  render(
    <MemoryRouter initialEntries={[entry]}>
      <Routes>{routeObjectsToRoutes(routes)}</Routes>
    </MemoryRouter>,
  );

/**
 * The closed tree hands its routes to the core as `RouteObject`s; the core
 * renders them inside its own `<Routes>`, next to its JSX routes.
 */
describe('routeObjectsToRoutes', () => {
  it('renders nested route objects as Routes', () => {
    renderAt('/a');
    expect(screen.getByText('A')).toBeInTheDocument();
  });

  it('renders a child route inside its parent', () => {
    renderAt('/b/c');
    expect(screen.getByText('B')).toBeInTheDocument();
    expect(screen.getByText('C')).toBeInTheDocument();
  });

  it('renders an index child', () => {
    renderAt('/d');
    expect(screen.getByText('D index')).toBeInTheDocument();
  });

  it('gives every element a key, so React never warns about the list', () => {
    const elements = routeObjectsToRoutes(routes);
    expect(elements.map((element) => element.key)).toEqual(['0', '1', '2']);
  });
});
