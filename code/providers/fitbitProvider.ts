import * as AuthSession from 'expo-auth-session';
import { getDefaultStore } from 'jotai';

import { TrackleError } from '#app/com/errors';
import { SecureAppStore } from '#app/data/store/app-store.ts';
import {
  HealthDataProvider,
  HealthMetric,
  HealthMetricSample,
  HealthProviderConfig,
  ProviderMetricConfig,
  SleepDataPoint,
  SleepStageType,
} from '#features/healthData/healthData.types.ts';
import { HealthDataError } from '#features/healthData/healthDataErrors.ts';

/**
 * Interface representing the authentication state for Fitbit OAuth
 */
interface FitbitAuthState {
  accessToken: string;
  expiresAt: number;
  scopes?: string[];
}

/**
 * persisted atom for Fitbit authentication state including access token using secure store
 */
export const FitbitAuthState$ = SecureAppStore.atomWithSecureStore<FitbitAuthState | null>(
  'fitbit-auth-state',
  null,
);

/**
 * Interfaces for Fitbit API responses
 */
interface FitbitSleepData {
  sleep: FitbitSleep[];
}

interface FitbitSleep {
  dateOfSleep: string;
  duration: number;
  efficiency: number;
  endTime: string;
  isMainSleep: boolean;
  levels: {
    data: FitbitSleepLevel[];
    shortData?: FitbitSleepLevel[];
    summary: {
      deep?: FitbitSleepSummary;
      light?: FitbitSleepSummary;
      rem?: FitbitSleepSummary;
      wake?: FitbitSleepSummary;
      asleep?: FitbitSleepSummary;
      restless?: FitbitSleepSummary;
      awake?: FitbitSleepSummary;
    };
  };
  logId: number;
  minutesAsleep: number;
  minutesAwake: number;
  startTime: string;
  timeInBed: number;
  type: 'classic' | 'stages';
}

interface FitbitSleepLevel {
  dateTime: string;
  level: 'wake' | 'light' | 'deep' | 'rem' | 'restless' | 'asleep';
  seconds: number;
}

interface FitbitSleepSummary {
  count: number;
  minutes: number;
  thirtyDayAvgMinutes?: number;
}

/**
 * Fitbit API endpoints and configuration
 */
const FITBIT_API = {
  AUTH: {
    AUTHORIZE: 'https://www.fitbit.com/oauth2/authorize',
    TOKEN: 'https://api.fitbit.com/oauth2/token',
    REVOKE: 'https://api.fitbit.com/oauth2/revoke',
  },
  ENDPOINTS: {
    sleep: 'https://api.fitbit.com/1.2/user/-/sleep/date',
  } as const,
} as const;

type FitbitEndpoint = keyof typeof FITBIT_API.ENDPOINTS;
interface FitbitResponse {
  sleep: FitbitSleepData;
}

/**
 * Provider implementation for Fitbit integration.
 * Handles OAuth authentication, data fetching and transformation of Fitbit health data.
 *
 * @implements {HealthDataProvider<FitbitEndpoint>}
 */
export class FitbitProvider implements HealthDataProvider<FitbitEndpoint> {
  private readonly store = getDefaultStore();

  readonly config: HealthProviderConfig = {
    polling: {
      supported: true,
      minIntervalMs: 1000 * 45, // 45 seconds, actual minimum by rate limit is 27 seconds
    },
    realtime: {
      supported: false,
    },
  };

  readonly id = 'fitbit';
  readonly name = 'Fitbit';
  readonly priority = 0;

  private readonly authConfig = {
    clientId: '23PYNL',
  };

  private readonly redirectURL = AuthSession.makeRedirectUri({
    path: 'fitbit',
  });

  private readonly discovery = {
    authorizationEndpoint: FITBIT_API.AUTH.AUTHORIZE,
    tokenEndpoint: FITBIT_API.AUTH.TOKEN,
    revocationEndpoint: FITBIT_API.AUTH.REVOKE,
  };

  /**
   * Mapping configuration for transforming Fitbit data into standardized metrics
   */
  readonly metricMapping: Partial<{
    [M in HealthMetric]: ProviderMetricConfig<FitbitEndpoint, M>;
  }> = {
    sleep: {
      identifiers: ['sleep'],
      transform: (data: FitbitResponse['sleep']): SleepDataPoint[] => {
        return data.sleep.map((sleep) => {
          const stages = this.mapSleepLevels(sleep.levels.data);
          return {
            source: this.id,
            stages,
            start: new Date(sleep.startTime),
            end: new Date(sleep.endTime),
          };
        });
      },
    },
  };

  /**
   * Mapping of Fitbit sleep stages to internal sleep stage types
   */
  private readonly sleepStageMapping: Record<string, SleepStageType> = {
    wake: 'awake',
    light: 'core',
    deep: 'deep',
    rem: 'rem',
    restless: 'awake',
    asleep: 'core',
  } as const;

  /**
   * Mapping of metrics to required Fitbit API scopes
   */
  private readonly metricScopeMapping: Record<HealthMetric, readonly string[]> = {
    sleep: ['sleep'],
    stress: [],
    illness: [],
  };

  /**
   * Initializes the Fitbit provider and handles OAuth authentication
   * @returns {Promise<boolean>} Success status of initialization
   */
  async init(): Promise<void> {
    try {
      await this.getValidToken();
    } catch (error) {
      throw new HealthDataError('PROVIDER_INIT_FAILED', {
        cause: error,
        message: 'Failed to initialize Fitbit provider',
      });
    }
  }

  /**
   * Gets a valid access token, refreshing if necessary
   * @returns {Promise<string>} Valid access token
   */
  private async getValidToken(): Promise<string> {
    const authState = this.store.get(FitbitAuthState$);
    const supportedMetrics = Object.keys(this.metricMapping) as HealthMetric[];

    const requiredScopes = supportedMetrics
      .flatMap((metric) => this.metricScopeMapping[metric])
      .filter((scope, index, array) => array.indexOf(scope) === index);

    if (this.needsNewToken(authState, requiredScopes)) {
      const request = new AuthSession.AuthRequest({
        clientId: this.authConfig.clientId,
        responseType: AuthSession.ResponseType.Token,
        scopes: requiredScopes,
        redirectUri: this.redirectURL,
      });

      const result = await request.promptAsync(this.discovery);

      if (result.type === 'success' && result.params.access_token) {
        const expiresIn = parseInt(result.params.expires_in!, 10);
        this.store.set(FitbitAuthState$, {
          accessToken: result.params.access_token,
          expiresAt: Date.now() + expiresIn * 1000,
          scopes: requiredScopes,
        });
        return result.params.access_token;
      } else {
        this.store.set(FitbitAuthState$, null);
      }
    }

    return authState.accessToken;
  }

  /**
   * Checks if a new token is needed based on the current state and required scopes
   * @param state
   * @param requiredScopes
   * @returns {boolean} Whether a new token is needed
   */
  private needsNewToken = (state: FitbitAuthState | null, requiredScopes: string[]): boolean => {
    if (!state) return true;
    if (this.isTokenExpired(state)) return true;

    const tokenScopes = state.scopes ?? [];
    return requiredScopes.some((scope) => !tokenScopes.includes(scope));
  };

  /**
   * Checks if the access token is expired or about to expire
   * @param {FitbitAuthState} authState - The current authentication state
   * @returns {boolean} Whether the token is expired or about to expire
   */
  private isTokenExpired(authState: FitbitAuthState): boolean {
    const timeUntilExpiry = authState.expiresAt - Date.now();
    return timeUntilExpiry < 0;
  }

  /**
   * Maps Fitbit sleep levels to internal sleep stage format
   * @param {FitbitSleepLevel[]} levels - Array of Fitbit sleep levels
   * @returns Array of standardized sleep stages
   */
  private mapSleepLevels(levels: FitbitSleepLevel[]) {
    return levels.map((level) => ({
      type: this.sleepStageMapping[level.level] ?? 'unspecified',
      start: new Date(level.dateTime),
      end: new Date(new Date(level.dateTime).getTime() + level.seconds * 1000),
    }));
  }

  /**
   * Checks if the Fitbit integration is available
   */
  async isAvailable(): Promise<boolean> {
    return Promise.resolve(true);
  }

  /**
   * Requests permissions for specified health metrics
   * @param {readonly HealthMetric[]} metrics - Array of metrics to request permissions for
   * @returns {Promise<boolean>} Whether permissions were granted
   */
  async requestPermissions(metrics: readonly HealthMetric[]): Promise<void> {
    const requiredScopes = metrics
      .flatMap((metric) => this.metricScopeMapping[metric])
      .filter((scope, index, array) => array.indexOf(scope) === index);

    if (requiredScopes.length === 0) {
      throw new HealthDataError('INVALID_METRIC', 'No supported metrics requested');
    }

    try {
      await this.getValidToken();
    } catch (error) {
      throw new HealthDataError('PERMISSION_DENIED', {
        cause: error,
        message: 'Failed to get Fitbit permissions',
      });
    }
  }

  /**
   * Retrieves health data for a specific metric within a time range
   * @param {M} metric - The health metric to retrieve
   * @param {Date} startDate - Start of the time range
   * @param {Date} endDate - End of the time range
   * @returns {Promise<HealthMetricSample<M>>} The retrieved health data
   */
  async getData<M extends HealthMetric>(
    metric: M,
    startDate: Date,
    endDate: Date,
  ): Promise<HealthMetricSample<M>> {
    const ONE_HUNDRED_DAYS_MS = 100 * 24 * 60 * 60 * 1000;
    const timespan = endDate.getTime() - startDate.getTime();

    if (timespan > ONE_HUNDRED_DAYS_MS) {
      console.warn('Timespan exceeds 100 days. Querying only the last 100 days.');
      startDate = new Date(endDate.getTime() - ONE_HUNDRED_DAYS_MS);
    }

    const mapping = this.metricMapping[metric];
    if (!mapping) {
      throw new HealthDataError('INVALID_METRIC', `Metric ${metric} not supported by ${this.name}`);
    }

    const dataMap: Partial<FitbitResponse> = {};

    try {
      await Promise.all(
        mapping.identifiers.map(async (identifier) => {
          dataMap[identifier] = await this.fetchData(identifier, startDate, endDate);
        }),
      );

      return {
        timestamp: new Date(),
        type: 'category',
        value: mapping.transform(dataMap.sleep),
      };
    } catch (error) {
      throw new HealthDataError('DATA_FETCH_ERROR', {
        cause: error,
        message: 'Failed to fetch Fitbit data',
      });
    }
  }

  /**
   * Fetches data from Fitbit API
   * @param {T} endpoint - API endpoint to fetch from
   * @param {Date} startDate - Start date for data range
   * @param {Date} endDate - End date for data range
   * @returns {Promise<FitbitResponse[T]>} API response data
   */
  private async fetchData<T extends FitbitEndpoint>(
    endpoint: T,
    startDate: Date,
    endDate: Date,
  ): Promise<FitbitResponse[T]> {
    const accessToken = await this.getValidToken();

    const url = new URL(
      `${FITBIT_API.ENDPOINTS[endpoint]}/${this.formatDate(startDate)}/${this.formatDate(endDate)}.json`,
    );

    const response = await fetch(url.toString(), {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      throw new HealthDataError('DATA_FETCH_ERROR', `Fitbit API error: ${response.statusText}`);
    }

    return (await response.json()) as Promise<FitbitResponse[T]>;
  }

  /**
   * Formats a date for Fitbit API requests
   * @param {Date} date - Date to format
   * @returns {string} Formatted date string
   */
  private formatDate(date: Date): string {
    return date.toISOString().split('T')[0]!;
  }

  /**
   * Not implemented as Fitbit doesn't support real-time data
   */
  onData(
    _callback: (metric: HealthMetric, data: HealthMetricSample<HealthMetric>) => void,
    _startDate: Date,
    _endDate: Date,
  ): Promise<() => void> {
    return Promise.resolve(() => {});
  }

  /**
   * Gets the list of metrics supported by this provider
   * @returns {HealthMetric[]} Array of supported metrics
   */
  getSupportedMetrics(): HealthMetric[] {
    return Object.keys(this.metricMapping) as HealthMetric[];
  }

  /**
   * Cleans up provider resources and revokes access token
   */
  async cleanUp(): Promise<void> {
    try {
      const authState = this.store.get(FitbitAuthState$);
      if (authState?.accessToken) {
        const response = await fetch(FITBIT_API.AUTH.REVOKE, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${authState.accessToken}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: `token=${authState.accessToken}`,
        });

        if (!response.ok) {
          throw new HealthDataError('CLEANUP_ERROR', 'Failed to revoke Fitbit token');
        }
      }
    } catch (error) {
      if (TrackleError.isTrackleError(error)) {
        throw error;
      }
      throw new HealthDataError('CLEANUP_ERROR', {
        cause: error,
        message: 'Error during Fitbit cleanup',
      });
    } finally {
      this.store.set(FitbitAuthState$, null);
    }
  }
}
