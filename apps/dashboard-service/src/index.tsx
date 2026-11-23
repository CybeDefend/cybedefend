// FIRST, on purpose: wipes the invitation mail's ?email from the address bar
// before any module that records the page URL is evaluated. The edition's
// trackers load only inside its boot hooks (below), which run after this
// import. See src/lib/invite-email-capture.ts.
import './lib/invite-email-capture';
import { ACTIVE_EXTENSIONS } from '@/edition/active';
import React, { Fragment } from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './index.css';
import App from './App';
import { AppErrorBoundary } from './components/organismes/app-failure/AppErrorBoundary';
import reportWebVitals from './reportWebVitals';
import { Provider } from 'react-redux';
import { RebacProvider } from 'react-rebac';
import store from './server/store';

// Import de la configuration i18n
import './i18n';

// The active edition's boot hooks, in their registered order: in a cloud build
// the closed tree's analytics and marketing captures run here (the trackers
// start, then the one-shot URL captures, the address-bar cleanup last, since
// it destroys their input). In the Community Edition the list is empty, so
// nothing tracker-like is ever loaded and `src/utils/profiler.ts` and
// `src/utils/analytics.ts` stay at their identity / no-op defaults.
ACTIVE_EXTENSIONS.boot.forEach((run) => run());

// The active edition's auth provider wraps <App/> (in the cloud, the identity
// provider's client, from the closed tree); the Community Edition has none.
const AuthProvider = ACTIVE_EXTENSIONS.AuthProvider ?? Fragment;

const root = ReactDOM.createRoot(
  document.getElementById('root') as HTMLElement
);
if (import.meta.env.DEV && window.location.pathname === '/__preview/loader') {
  // Dev only: the start loader on a loop, to watch its motion locally (src/dev/LoaderPreview.tsx).
  void import('./dev/LoaderPreview').then(({ default: LoaderPreview }) => {
    root.render(
      <Provider store={store}>
        <LoaderPreview />
      </Provider>
    );
  });
} else if (import.meta.env.DEV && window.location.pathname === '/__preview/app-error') {
  // Dev only: the page the app shows when it cannot start, with its variants (src/dev/AppFailurePreview.tsx).
  void import('./dev/AppFailurePreview').then(({ default: AppFailurePreview }) => {
    root.render(<AppFailurePreview />);
  });
} else {
  root.render(
    <Provider store={store}>
      <BrowserRouter>
        <AuthProvider>
          <RebacProvider>
            {/* A render crash shows the crash page of the failure family, never a blank page. */}
            <AppErrorBoundary>
              <App />
            </AppErrorBoundary>
          </RebacProvider>
        </AuthProvider>
      </BrowserRouter>
    </Provider>
  );
}

reportWebVitals();
