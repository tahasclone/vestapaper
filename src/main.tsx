import React, { Suspense, lazy } from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import './index.css';

// Code-split so an anonymous visitor doesn't download the board and app bundles.
const LandingPage = lazy(() =>
  import('./pages/LandingPage').then((m) => ({ default: m.LandingPage })),
);
const BoardPage = lazy(() => import('./pages/BoardPage').then((m) => ({ default: m.BoardPage })));
const SettingsPage = lazy(() =>
  import('./pages/SettingsPage').then((m) => ({ default: m.SettingsPage })),
);

const router = createBrowserRouter([
  { path: '/', element: <LandingPage /> },
  // The board's URL carries an unguessable token in the path rather than
  // relying on a cookie: Plash's storage persistence cannot be trusted.
  { path: '/b/:token', element: <BoardPage /> },
  { path: '/settings', element: <SettingsPage /> },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Suspense fallback={null}>
      <RouterProvider router={router} />
    </Suspense>
  </React.StrictMode>,
);
