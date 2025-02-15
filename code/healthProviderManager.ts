import { getDefaultStore } from 'jotai';

import { TrackleError } from '#app/com/errors';
import { createServiceLocator, getService, TraService } from '#app/service';
import {
  HealthDataProvider,
  HealthMetric,
  HealthMetricSample,
} from '#features/healthData/healthData.types.ts';
import { HEALTH_METRICS, POLLING_INTERVAL } from '#features/healthData/healthDataConstants.ts';
import { HealthDataError } from '#features/healthData/healthDataErrors.ts';
import { ProviderState$ } from '#features/healthData/HealthProviderState.ts';
import { AppleHealthProvider } from '#features/healthData/providers/appleHealthProvider.ts';
import { FitbitProvider } from '#features/healthData/providers/fitbitProvider.ts';
import { GoogleHealthProvider } from '#features/healthData/providers/googleHealthProvider.ts';

/**
 * Service locator for the HealthProviderManager
 */
export const HealthProviderRegistryLoc = createServiceLocator('HealthProviderManager', () => {
  return new HealthProviderManager();
});

/**
 * Manages health data providers and coordinates data collection
 * Handles provider registration, initialization, data polling, and real-time updates
 *
 * @implements {TraService}
 */
export class HealthProviderManager implements TraService {
  private readonly providers = new Map<string, HealthDataProvider<any>>();
  private readonly store = getDefaultStore();
  private readonly providerSubscriptions = new Map<string, () => void | Promise<void>>();
  private readonly dataCallbacks = new Set<
    (metric: HealthMetric, data: HealthMetricSample<HealthMetric>) => void
  >();
  private readonly pollingIntervals = new Map<string, NodeJS.Timer>();

  readonly _tag = 'HealthProviderManager';

  constructor() {
    void this.registerProvider(new AppleHealthProvider());
    void this.registerProvider(new GoogleHealthProvider());
    void this.registerProvider(new FitbitProvider());
  }

  /**
   * Registers a new health data provider
   * @param {HealthDataProvider<any>} provider - Provider to register
   */
  async registerProvider(provider: HealthDataProvider<any>): Promise<void> {
    const isAvailable = await provider.isAvailable();

    if (isAvailable) {
      if (this.providers.has(provider.id)) {
        throw new Error(`Provider with id ${provider.id} is already registered`);
      }
      this.providers.set(provider.id, provider);

      if (provider.config.realtime.supported) {
        await this.initializeProviderStream(provider, new Date());
      }
    }
  }

  /**
   * Enables a provider and initializes its data collection
   * @param {string} providerId - ID of the provider to enable
   * @param {Date} queryStartDate - Start date for data collection
   * @returns {Promise<boolean>} Success status
   */
  async enableProvider(providerId: string, queryStartDate: Date): Promise<void> {
    const provider = this.providers.get(providerId);
    if (!provider) {
      throw new HealthDataError('PROVIDER_NOT_FOUND', `Provider ${providerId} not found`);
    }

    try {
      await provider.init();
      await provider.requestPermissions(HEALTH_METRICS);

      if (provider.config.realtime.supported) {
        await this.initializeProviderStream(provider, queryStartDate);
      }

      if (provider.config.polling.supported) {
        this.startPollingForProvider(provider, queryStartDate);
      }
    } catch (error) {
      if (TrackleError.isTrackleError(error)) {
        throw error;
      }
      throw new HealthDataError('PROVIDER_INIT_FAILED', {
        cause: error,
        message: `Failed to initialize provider ${providerId}`,
      });
    }
  }

  /**
   * Disables a provider and cleans up its resources
   * @param {string} providerId - ID of the provider to disable
   */
  async disableProvider(providerId: string) {
    const cleanup = this.providerSubscriptions.get(providerId);
    if (cleanup) {
      try {
        await cleanup();
        this.providerSubscriptions.delete(providerId);
      } catch (error) {
        if (TrackleError.isTrackleError(error)) {
          throw error;
        }
        throw new HealthDataError('CLEANUP_ERROR', {
          cause: error,
          message: `Failed to clean up provider ${providerId}`,
        });
      }
    }

    this.stopPollingForProvider(providerId);
    const provider = this.providers.get(providerId);
    await provider?.cleanUp();
  }

  /**
   * Starts polling data from all enabled providers
   * @param {Date} startDate - Start date for data collection
   */
  startPollingEnabledProviders(startDate: Date) {
    const enabledProviders = this.store.get(ProviderState$).enabledProviders;

    for (const providerId of enabledProviders) {
      const provider = this.providers.get(providerId);
      if (provider) {
        this.startPollingForProvider(provider, startDate);
      }
    }
  }

  /**
   * Starts polling data from a specific provider
   * @param {HealthDataProvider<any>} provider - Provider to poll
   * @param {Date} startDate - Start date for data collection
   */
  private startPollingForProvider(provider: HealthDataProvider<any>, startDate: Date) {
    if (!provider.config.polling.supported) return;

    this.stopPollingForProvider(provider.id);

    for (const metric of provider.getSupportedMetrics()) {
      const pollData = async () => {
        try {
          const now = new Date();
          const data = await provider.getData(metric, startDate, now);
          if (this.hasValidData(metric, data)) {
            this.notifyCallbacks(metric, data);
          }
        } catch (error) {
          if (TrackleError.isTrackleError(error)) {
            throw error;
          }
          throw new HealthDataError('POLLING_ERROR', {
            cause: error,
            message: `Failed to poll data for provider ${provider.id}`,
          });
        }
      };

      void pollData();

      const interval = setInterval(
        pollData,
        POLLING_INTERVAL < provider.config.polling.minIntervalMs
          ? provider.config.polling.minIntervalMs
          : POLLING_INTERVAL,
      );

      this.pollingIntervals.set(`${provider.id}-${metric}`, interval);
    }
  }

  /**
   * Stops polling for a specific provider
   * @param {string} providerId - ID of the provider
   */
  private stopPollingForProvider(providerId: string) {
    for (const [key, interval] of this.pollingIntervals.entries()) {
      if (key.startsWith(`${providerId}-`)) {
        clearInterval(interval);
        this.pollingIntervals.delete(key);
      }
    }
  }

  /**
   * Initializes real-time data stream from a provider
   * @param {HealthDataProvider<any>} provider - Provider to initialize
   * @param {Date} startDate - Start date for data collection
   */
  private async initializeProviderStream(
    provider: HealthDataProvider<any>,
    startDate: Date,
  ): Promise<void> {
    try {
      const cleanupFn = await provider.onData(
        (metric, data) => {
          this.notifyCallbacks(metric, data);
        },
        startDate,
        new Date(),
      );

      this.providerSubscriptions.set(provider.id, cleanupFn);
    } catch (error) {
      if (TrackleError.isTrackleError(error)) {
        throw error;
      } else {
        throw new HealthDataError('SUBSCRIPTION_ERROR', {
          cause: error,
          message: `Failed to initialize data stream for provider ${provider.id}`,
        });
      }
    }
  }

  /**
   * Subscribes to provider data updates
   * @param {Function} callback - Callback function for updates
   * @returns {Function} Cleanup function
   */
  public subscribeToProviderUpdates(
    callback: (metric: HealthMetric, data: HealthMetricSample<HealthMetric>) => void,
  ): () => void {
    this.dataCallbacks.add(callback);

    return () => {
      this.dataCallbacks.delete(callback);
      if (this.dataCallbacks.size === 0) {
        void this.cleanupAllSubscriptions();
      }
    };
  }

  /**
   * Notifies all callbacks with new data
   * @param {HealthMetric} metric - Health metric type
   * @param {HealthMetricSample<HealthMetric>} data - New data
   */
  private notifyCallbacks(metric: HealthMetric, data: HealthMetricSample<HealthMetric>) {
    for (const callback of this.dataCallbacks) {
      callback(metric, data);
    }
  }

  /**
   * Cleans up all provider subscriptions
   */
  private async cleanupAllSubscriptions() {
    try {
      for (const cleanup of this.providerSubscriptions.values()) {
        await cleanup();
      }
      this.providerSubscriptions.clear();
    } catch (error) {
      throw new HealthDataError('CLEANUP_ERROR', {
        cause: error,
        message: 'Failed to cleanup provider subscriptions',
      });
    }
  }

  /**
   * Gets all providers that support a specific metric
   * @param {HealthMetric} metric - Health metric type
   * @returns {HealthDataProvider<any>[]} Array of providers
   */
  getProvidersForMetric(metric: HealthMetric): HealthDataProvider<any>[] {
    const enabledProviders = this.store.get(ProviderState$).enabledProviders;

    return Array.from(this.providers.values())
      .filter(
        (provider) =>
          provider.getSupportedMetrics().includes(metric) && enabledProviders.includes(provider.id),
      )
      .sort((a, b) => b.priority - a.priority);
  }

  /**
   * Gets all registered providers
   * @returns {HealthDataProvider<any>[]} Array of all providers
   */
  getAllProviders(): HealthDataProvider<any>[] {
    return Array.from(this.providers.values());
  }

  // TODO - Implement this method fully
  /**
   * Validates health metric data
   * @param {M} _metric - Health metric type
   * @param {HealthMetricSample<M>} data - Data to validate
   * @returns {boolean} Whether the data is valid
   */
  private hasValidData<M extends HealthMetric>(_metric: M, data: HealthMetricSample<M>): boolean {
    if (!data.value) return false;
    return Array.isArray(data.value) && data.value.length > 0;
  }

  /**
   * Cleans up all resources when service is finalized
   */
  finalize() {
    void this.cleanupAllSubscriptions();
    for (const interval of this.pollingIntervals.values()) {
      clearInterval(interval);
    }
    this.pollingIntervals.clear();
  }
}
