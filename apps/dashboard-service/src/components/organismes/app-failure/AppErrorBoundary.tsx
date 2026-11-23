import React from 'react';

import AppFailurePage from './AppFailurePage';
import { escapeToSignIn, reloadPage } from './appFailureActions';

/**
 * The root error boundary, around <App/> in `src/index.tsx`. Without it, a
 * render crash anywhere in the app would leave a blank page. It shows the crash page of the failure family instead: the same mark,
 * a calm sentence, « Try again » (a reload) and « Sign in again » (the same
 * purge as the session and workspace pages).
 *
 * The error goes to the console only, no telemetry, and its text is never
 * shown: it can carry a server's words, a token or a path. Narrower
 * boundaries keep their own fallback (the global chat's
 * `RendererWithFallback`).
 */
export interface AppErrorBoundaryProps {
  children: React.ReactNode;
  /** Tests only: what « Try again » does instead of reloading. */
  onRetry?: () => void;
  /** Tests only: what « Sign in again » does instead of the purge and /login. */
  onSignIn?: () => void;
}

interface AppErrorBoundaryState {
  crashed: boolean;
}

export class AppErrorBoundary extends React.Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { crashed: false };

  static getDerivedStateFromError(): AppErrorBoundaryState {
    return { crashed: true };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[AppErrorBoundary] the app crashed while rendering', error, info.componentStack);
  }

  render(): React.ReactNode {
    if (!this.state.crashed) return this.props.children;
    return (
      <AppFailurePage
        variant="crash"
        onRetry={this.props.onRetry ?? reloadPage}
        onSignIn={this.props.onSignIn ?? escapeToSignIn}
      />
    );
  }
}

export default AppErrorBoundary;
