import { createRoot } from 'react-dom/client';
import { App } from './App';
import { PlannerProvider } from './planner';
import { StoreProvider } from './store';
import './styles.css';

createRoot(document.getElementById('root')!).render(
  <StoreProvider>
    <PlannerProvider>
      <App />
    </PlannerProvider>
  </StoreProvider>,
);
