import { TrackleError } from '#app/com/errors';
import { createServiceLocator, getService, TraService } from '#app/service';
import {
  HealthData,
  HealthMetric,
  HealthMetricSample,
  HealthMetricValueMap,
} from '#features/healthData/healthData.types.ts';
import { HealthDataError } from '#features/healthData/healthDataErrors.ts';
import { HealthProviderRegistryLoc } from '#features/healthData/healthProviderManager.ts';

/**
 * Service locator for the HealthDataService
 */
export const HealthDatServiceLoc = createServiceLocator('HealthDataService', () => {
  return new HealthDataService();
});

/**
 * Service responsible for managing and consolidating health data from multiple providers
 * Handles data synchronization, merging, and subscription management
 *
 * @implements {TraService}
 */
class HealthDataService implements TraService {
  readonly _tag = 'HealthDataService';

  private readonly healthProviderManager = getService(HealthProviderRegistryLoc);

  /**
   * Gets priority mapping for all providers
   * @returns {Record<string, number>} Map of provider IDs to their priorities
   */
  private getProviderPriorities(): Record<string, number> {
    const providers = this.healthProviderManager.getAllProviders();
    return providers.reduce(
      (priorities, provider) => {
        priorities[provider.id] = provider.priority;
        return priorities;
      },
      {} as Record<string, number>,
    );
  }

  /**
   * Subscribes to health data updates from all providers
   * @param {Function} callback - Callback function for updates
   * @returns {Function} Cleanup function
   */
  subscribeToHealthUpdates(
    callback: (metric: HealthMetric, data: HealthMetricSample<HealthMetric>) => void,
  ): () => void {
    return this.healthProviderManager.subscribeToProviderUpdates(callback);
  }

  /**
   * Synchronizes health data for specified metrics from all providers
   * @param {readonly HealthMetric[]} metrics - Metrics to sync
   * @param {Date} lastSync - Start date for sync
   * @returns {Promise<Object>} Synchronized health data
   */
  async syncHealthData(metrics: readonly HealthMetric[], lastSync: Date) {
    const now = new Date();
    try {
      const data = await this.consolidateHealthMetrics(metrics, lastSync, now);

      return {
        error: null,
        isLoading: false,
        healthData: data,
        lastSync: now,
      };
    } catch (error) {
      return {
        error: error.message,
        isLoading: false,
        healthData: {},
        lastSync: lastSync,
      };
    }
  }

  /**
   * Consolidates health metrics from all providers for a given time range
   * @param {readonly HealthMetric[]} metrics - Metrics to consolidate
   * @param {Date} startDate - Start of time range
   * @param {Date} endDate - End of time range
   * @returns {Promise<HealthData>} Consolidated health data
   */
  private async consolidateHealthMetrics(
    metrics: readonly HealthMetric[],
    startDate: Date,
    endDate: Date,
  ): Promise<HealthData> {
    const result: HealthData = {};

    for (const metric of metrics) {
      const providers = this.healthProviderManager.getProvidersForMetric(metric);
      const allDataPoints: HealthMetricValueMap[typeof metric] = [];

      // Collect data from all providers
      for (const provider of providers) {
        try {
          const data = await provider.getData(metric, startDate, endDate);
          if (this.hasValidData(metric, data)) {
            const dataPointsWithSource = data.value.map((point) => ({
              ...point,
              source: provider.id,
            }));
            allDataPoints.push(...dataPointsWithSource);
          }
        } catch (error) {
          if (TrackleError.isTrackleError(error)) {
            throw error;
          }
          throw new HealthDataError('DATA_FETCH_ERROR', 'Failed to fetch health data');
        }
      }

      allDataPoints.sort((a, b) => a.start.getTime() - b.start.getTime());

      const providerPriorities = providers.reduce(
        (map, provider) => {
          map[provider.id] = provider.priority;
          return map;
        },
        {} as Record<string, number>,
      );

      const mergedDataPoints = this.mergeDataPoints(allDataPoints, providerPriorities);

      if (mergedDataPoints.length > 0) {
        result[metric] = {
          value: mergedDataPoints,
          type: 'category',
          timestamp: new Date(),
        };
      }
    }

    return result;
  }

  /**
   * Merges existing metric data with new data
   * @param {HealthMetricSample<M> | undefined} existing - Existing data
   * @param {HealthMetricSample<M>} newData - New data to merge
   * @returns {HealthMetricSample<M>} Merged data
   */
  mergeMetricData<M extends HealthMetric>(
    existing: HealthMetricSample<M> | undefined,
    newData: HealthMetricSample<M>,
  ): HealthMetricSample<M> {
    if (!existing) return newData;

    const providerPriorities = this.getProviderPriorities();
    const merged = this.mergeDataPoints([...existing.value, ...newData.value], providerPriorities);

    return {
      value: merged,
      type: newData.type,
      timestamp: new Date(),
    };
  }

  /**
   * Merges overlapping data points based on provider priorities
   * @param {HealthMetricValueMap[M]} dataPoints - Data points to merge
   * @param {Record<string, number>} providerPriorities - Provider priority mapping
   * @returns {HealthMetricValueMap[M]} Merged data points
   */
  private mergeDataPoints<M extends HealthMetric>(
    dataPoints: HealthMetricValueMap[M],
    providerPriorities: Record<string, number>,
  ): HealthMetricValueMap[M] {
    if (dataPoints.length === 0) return [] as HealthMetricValueMap[M];

    const pointsWithDateObjects = dataPoints.map((point) => {
      return {
        ...point,
        start: new Date(point.start),
        end: new Date(point.end),
      };
    });

    const sortedPoints = [...pointsWithDateObjects].sort(
      (a, b) => a.start.getTime() - b.start.getTime(),
    );

    const merged: typeof sortedPoints = [];

    for (const point of sortedPoints) {
      const overlapping = merged.find(
        (existing) =>
          point.start.getTime() <= existing.end.getTime() &&
          point.end.getTime() >= existing.start.getTime(),
      );

      if (!overlapping) {
        merged.push(point);
      } else {
        const currentPriority = providerPriorities[point.source];
        const existingPriority = providerPriorities[overlapping.source];

        if (currentPriority === undefined || existingPriority === undefined) {
          throw new HealthDataError('PRIORITY_ERROR', {
            message: 'Provider priority not found',
            cause: {
              providerId: point.source,
              priorities: providerPriorities,
            },
          });
        }

        if (currentPriority > existingPriority) {
          const index = merged.indexOf(overlapping);
          merged[index] = point;
        }
      }
    }

    return merged as HealthMetricValueMap[M];
  }

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
   * Finalizes the service
   */
  finalize() {
    // No cleanup needed
  }
}
