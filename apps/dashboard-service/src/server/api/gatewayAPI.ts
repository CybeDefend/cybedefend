// src/server/api/gatewayAPI.ts
import axios, { AxiosError, InternalAxiosRequestConfig } from 'axios';
import store from '../store';
import { setAccessToken, clearAccessToken } from '../store/authSlice';
import { refreshAccessToken, isSessionBroken } from './tokenManager';
import { getRegionConfig } from '@/utils/function/region';
import { ACTIVE_EXTENSIONS } from '@/edition/active';

const gatewayAPI = axios.create({
  headers: { 'Content-Type': 'application/json' },
});

// An edition's interceptor whose module loads on demand starts loading with
// the API client, created once the edition entry has evaluated, so it answers
// the first refusal synchronously.
ACTIVE_EXTENSIONS.responseInterceptors.forEach((handle) => {
  void (handle as { ready?: () => Promise<unknown> }).ready?.();
});

gatewayAPI.interceptors.request.use(async (config) => {
  const { apiUrl } = getRegionConfig();
  config.baseURL = apiUrl;

  const token = store.getState().auth.accessToken;
  if (token) {
    config.headers = config.headers ?? {};
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

gatewayAPI.interceptors.response.use(
  (res) => res,
  async (error: AxiosError) => {
    const originalRequest = error.config as InternalAxiosRequestConfig & {
      _retry?: boolean;
    };

    // The refusals the edition's own interceptors handle (a notice of their
    // own: a billing edition's exhausted trial, a blocked product unit); the
    // caller still receives the error.
    if (ACTIVE_EXTENSIONS.responseInterceptors.some((handle) => handle(error))) {
      return Promise.reject(error);
    }

    // Only retry once, only on 401, and not on auth endpoints themselves
    if (
      error.response?.status === 401 &&
      originalRequest &&
      !originalRequest._retry
    ) {
      originalRequest._retry = true;

      // If the session is already known to be broken, skip the network round-trip
      // and immediately clear auth state (useLogtoAuth will redirect to login).
      if (isSessionBroken()) {
        store.dispatch(clearAccessToken());
        return Promise.reject(error);
      }

      // The bearer the gateway refused: the session client must not hand it back.
      const sent = originalRequest.headers?.Authorization;
      const refusedToken =
        typeof sent === 'string' && sent.startsWith('Bearer ') ? sent.slice('Bearer '.length) : undefined;
      const freshToken = await (refusedToken ? refreshAccessToken({ refusedToken }) : refreshAccessToken());
      if (freshToken) {
        // Update Redux so subsequent requests also use the new token
        store.dispatch(setAccessToken(freshToken));

        // Retry the original request with the fresh token
        originalRequest.headers.Authorization = `Bearer ${freshToken}`;
        return gatewayAPI(originalRequest);
      }

      // Transient refresh failure: keep the token we have. A stale token keeps
      // the 401 → refresh path alive for the next request; clearing it would
      // send every following request without Authorization and hide the real
      // state. The token is only dropped once the session is known broken
      // (permanent grant error at Logto → forced sign-in already in flight).
      if (isSessionBroken()) {
        store.dispatch(clearAccessToken());
      }
    }

    return Promise.reject(error);
  },
);

export default gatewayAPI;
