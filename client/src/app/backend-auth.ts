import { HttpInterceptorFn } from '@angular/common/http';
import './models';

export const backendAuth: HttpInterceptorFn = (request, next) => {
  const app = window.mrgoose;
  if (app?.backendToken && new URL(request.url, window.location.href).origin === new URL(app.backendUrl).origin) {
    return next(request.clone({ setHeaders: { Authorization: `Bearer ${app.backendToken}` } }));
  }
  return next(request);
};
