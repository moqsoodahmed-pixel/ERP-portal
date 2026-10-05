import { ok } from '../utils/response.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { env } from '../config/env.js';
import { makeContext } from '../utils/context.js';

export const REFRESH_COOKIE = 'refreshToken';
const cookieOptions = (expires) => ({
  httpOnly: true, secure: env.cookieSecure, sameSite: 'strict', path: '/api/v1/auth', expires,
});
const meta = (req) => ({ ip: req.ip, userAgent: req.get('user-agent')?.slice(0, 300), requestId: req.id });

export function createAuthController({ authService }) {
  return {
    login: asyncHandler(async (req, res) => {
      const { accessToken, refreshToken, refreshExpiresAt, user } = await authService.login(req.body, meta(req));
      res.cookie(REFRESH_COOKIE, refreshToken, cookieOptions(refreshExpiresAt));
      ok(req, res, { accessToken, user }, 'Login successful');
    }),
    refresh: asyncHandler(async (req, res) => {
      try {
        const { accessToken, refreshToken, refreshExpiresAt } = await authService.refresh(req.cookies?.[REFRESH_COOKIE], meta(req));
        res.cookie(REFRESH_COOKIE, refreshToken, cookieOptions(refreshExpiresAt));
        ok(req, res, { accessToken }, 'Token refreshed');
      } catch (err) {
        res.clearCookie(REFRESH_COOKIE, cookieOptions());
        throw err;
      }
    }),
    logout: asyncHandler(async (req, res) => {
      await authService.logout(req.cookies?.[REFRESH_COOKIE], meta(req));
      res.clearCookie(REFRESH_COOKIE, cookieOptions());
      ok(req, res, null, 'Logged out');
    }),
    me: asyncHandler(async (req, res) => ok(req, res, await authService.profile(req.auth))),
    changePassword: asyncHandler(async (req, res) => {
      await authService.changePassword(makeContext(req), req.body);
      res.clearCookie(REFRESH_COOKIE, cookieOptions());
      ok(req, res, null, 'Password changed. Please sign in again.');
    }),
  };
}
