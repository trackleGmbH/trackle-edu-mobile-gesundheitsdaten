import { createTrackleError } from '#app/com/errors/TrackleError.ts';

export const HealthDataError = createTrackleError('HealthData', [
  'PROVIDER_NOT_FOUND',
  'PROVIDER_INIT_FAILED',
  'PERMISSION_DENIED',
  'DATA_FETCH_ERROR',
  'INVALID_METRIC',
  'PROVIDER_UNAVAILABLE',
  'SUBSCRIPTION_ERROR',
  'CLEANUP_ERROR',
  'POLLING_ERROR',
  'PRIORITY_ERROR',
  'DATA_FETCH_ERROR',
] as const);
