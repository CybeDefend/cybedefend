import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { useSafeNavigate, SafeNavigator } from './useSafeNavigate';

/**
 * `useSafeNavigate` originally called `useNavigate()`
 * conditionally inside an `if (inRouter)` branch (suppressed by
 * eslint-disable react-hooks/rules-of-hooks), violating React's Rules of
 * Hooks. The fix:
 *  - Adds a `<SafeNavigator>` render-prop component that splits the
 *    in-router and standalone paths into two distinct sub-components,
 *    each with a stable hook order.
 *  - Tightens `useSafeNavigate()` to ALWAYS call `useNavigate()`
 *    unconditionally (no more eslint-disable). The hook now requires its
 *    consumer to be rendered inside a Router; for standalone renders
 *    consumers must use `<SafeNavigator>` instead.
 *
 * Tests cover:
 *  1. `useSafeNavigate` works inside a Router (production path).
 *  2. `useSafeNavigate` throws outside a Router (contract enforced).
 *  3. `<SafeNavigator>` renders a working navigator inside a Router.
 *  4. `<SafeNavigator>` falls back to `window.location.assign` outside a
 *     Router.
 */
describe('useSafeNavigate / SafeNavigator', () => {
    let assignSpy: ReturnType<typeof vi.fn>;
    let originalLocation: Location;

    beforeEach(() => {
        assignSpy = vi.fn();
        originalLocation = window.location;
        Object.defineProperty(window, 'location', {
            configurable: true,
            writable: true,
            value: {
                ...originalLocation,
                assign: assignSpy,
            },
        });
    });

    afterEach(() => {
        Object.defineProperty(window, 'location', {
            configurable: true,
            writable: true,
            value: originalLocation,
        });
    });

    describe('useSafeNavigate', () => {
        const Consumer: React.FC<{ to: string }> = ({ to }) => {
            const navigate = useSafeNavigate();
            return (
                <button type="button" onClick={() => navigate(to)}>
                    go
                </button>
            );
        };

        it('navigates via router when mounted inside a <Router>', () => {
            render(
                <MemoryRouter initialEntries={['/start']}>
                    <Consumer to="/target" />
                </MemoryRouter>,
            );
            fireEvent.click(screen.getByText('go'));
            // Router navigate updates internal history; window.location.assign
            // MUST NOT be called.
            expect(assignSpy).not.toHaveBeenCalled();
        });

        it('throws if used outside a <Router> (contract enforced)', () => {
            // react-router-dom's `useNavigate()` invariant fires on render.
            // We silence the act() warning that React emits when the render
            // throws synchronously.
            const consoleError = vi
                .spyOn(console, 'error')
                .mockImplementation(() => {});
            expect(() => render(<Consumer to="/x" />)).toThrow(
                /useNavigate\(\) may be used only in the context of a <Router> component\./,
            );
            consoleError.mockRestore();
        });
    });

    describe('SafeNavigator render-prop', () => {
        it('passes a navigate function to children inside a Router', () => {
            render(
                <MemoryRouter initialEntries={['/x']}>
                    <SafeNavigator>
                        {(navigate) => (
                            <button
                                type="button"
                                onClick={() => navigate('/router-target')}
                            >
                                go
                            </button>
                        )}
                    </SafeNavigator>
                </MemoryRouter>,
            );
            fireEvent.click(screen.getByText('go'));
            expect(assignSpy).not.toHaveBeenCalled();
        });

        it('falls back to window.location.assign outside a Router', () => {
            render(
                <SafeNavigator>
                    {(navigate) => (
                        <button
                            type="button"
                            onClick={() => navigate('/no-router')}
                        >
                            go
                        </button>
                    )}
                </SafeNavigator>,
            );
            fireEvent.click(screen.getByText('go'));
            expect(assignSpy).toHaveBeenCalledWith('/no-router');
        });
    });
});
