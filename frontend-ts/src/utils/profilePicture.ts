import { env } from '@/config/env';

/**
 * Returns a profile picture src URL that will work with auth-protected endpoints.
 * Converts backend URLs to relative paths so requests are same-origin and cookies are sent
 * (Vite proxy in dev forwards /api to backend; production often serves both from same domain).
 */
export function getProfilePictureSrc(
  url: string | undefined,
  cacheBust?: number | null
): string {
  const base = url || '/default profile icon.png';
  const backendBase = env.backendUrl.replace(/\/$/, '');

  // If it's our backend's profile-picture URL, use relative path so cookies are sent
  if (
    base.startsWith('http') &&
    (base.startsWith(backendBase) || base.includes('/api/user/profile-picture'))
  ) {
    const path = cacheBust != null
      ? `/api/user/profile-picture?t=${cacheBust}`
      : '/api/user/profile-picture';
    return path;
  }

  return base.startsWith('http') && cacheBust != null
    ? `${base}?t=${cacheBust}`
    : base;
}
