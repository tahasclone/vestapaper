import React from 'react';
import ReactDOM from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { BoardPage } from './pages/BoardPage';
import { SettingsPage } from './pages/SettingsPage';
import './index.css';

const router = createBrowserRouter([
  { path: '/', element: <BoardPage /> },
  { path: '/settings', element: <SettingsPage /> },
]);

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RouterProvider router={router} />
  </React.StrictMode>,
);
