import { Routes } from '@angular/router';
import { AssistantPage } from './pages/assistant';
import { PromptsPage } from './pages/prompts';
import { TechniquesPage } from './pages/techniques';
import { ChallengesPage } from './pages/challenges';
import { WorkbenchPage } from './pages/agent';
import { SettingsPage } from './pages/settings';

export const routes: Routes = [
  { path: '', pathMatch: 'full', redirectTo: 'workbench' },
  { path: 'assistant', component: AssistantPage },
  { path: 'prompts', component: PromptsPage },
  { path: 'techniques', component: TechniquesPage },
  { path: 'challenges', component: ChallengesPage },
  { path: 'workbench', component: WorkbenchPage },
  // legacy deep-links
  { path: 'agent', redirectTo: 'workbench' },
  { path: 'chatbot', redirectTo: 'workbench' },
  { path: 'tabs', redirectTo: 'workbench' },
  { path: 'settings', component: SettingsPage },
  { path: '**', redirectTo: 'workbench' },
];
