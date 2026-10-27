import { ApplicationConfig, provideBrowserGlobalErrorListeners } from '@angular/core';
import { provideRouter, withComponentInputBinding } from '@angular/router';
import { provideHttpClient, withInterceptors } from '@angular/common/http';
import { backendAuth } from './backend-auth';

import { routes } from './app.routes';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideHttpClient(withInterceptors([backendAuth])),
    // withComponentInputBinding lets route `data` flow straight into page @Input()s.
    provideRouter(routes, withComponentInputBinding()),
  ],
};
