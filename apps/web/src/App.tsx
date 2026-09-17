import { RouterProvider } from 'react-router-dom';
import { router } from './app/routes';
import { ClientProvider } from './app/shell/ClientProvider';
import { ThemeProvider } from './app/shell/ThemeProvider';

export function App() {
  return (
    <ThemeProvider>
      <ClientProvider>
        <RouterProvider router={router} />
      </ClientProvider>
    </ThemeProvider>
  );
}
