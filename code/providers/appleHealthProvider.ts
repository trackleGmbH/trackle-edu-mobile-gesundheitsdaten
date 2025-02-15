import Healthkit, {
  HKCategorySample,
  HKCategoryTypeIdentifier,
  HKCategoryValueSleepAnalysis,
  HKQuantityTypeIdentifier,
} from '@kingstinct/react-native-healthkit';

import {
  HealthDataProvider,
  HealthMetric,
  HealthMetricSample,
  IllnessDataPoint,
  IllnessType,
  ProviderMetricConfig,
  Severity,
  SleepDataPoint,
  SleepStage,
  SleepStageType,
} from '#features/healthData/healthData.types.ts';
import { HealthDataError } from '#features/healthData/healthDataErrors.ts';

/**
 * Interface representing sleep data structure from Apple HealthKit
 */
interface AppleSleepData {
  [HKCategoryTypeIdentifier.sleepAnalysis]: HKCategorySample[];
}

/**
 * Interface representing illness-related data structure from Apple HealthKit
 */
interface AppleIllnessData {
  [HKCategoryTypeIdentifier.fever]: HKCategorySample[];
  [HKCategoryTypeIdentifier.chills]: HKCategorySample[];
  [HKCategoryTypeIdentifier.diarrhea]: HKCategorySample[];
  [HKCategoryTypeIdentifier.headache]: HKCategorySample[];
  [HKCategoryTypeIdentifier.fatigue]: HKCategorySample[];
  [HKCategoryTypeIdentifier.coughing]: HKCategorySample[];
}

/**
 * Type mapping for different health metrics in Apple HealthKit
 */
interface AppleHealthMetricDataMap {
  sleep: AppleSleepData;
  illness: AppleIllnessData;
  stress: never;
}

/**
 * Provider implementation for Apple HealthKit integration.
 * Handles data fetching, transformation and real-time updates for health metrics.
 *
 * @implements {HealthDataProvider<HKCategoryTypeIdentifier | HKQuantityTypeIdentifier>}
 */
export class AppleHealthProvider
  implements HealthDataProvider<HKCategoryTypeIdentifier | HKQuantityTypeIdentifier>
{
  readonly id = 'apple-health';
  readonly name = 'Apple Health';
  readonly priority = 10;

  readonly config = {
    polling: {
      supported: true,
      minIntervalMs: 1000 * 60, // 5 minutes
    },
    realtime: {
      supported: true,
    },
  };

  private readonly MAX_GAP_MINUTES = 120; // 2 hour threshold for new session
  private observers: Map<string, () => void> = new Map<string, () => void>();

  /**
   * Mapping configuration for transforming Apple HealthKit data into standardized metrics
   */
  readonly metricMapping: Partial<{
    [M in HealthMetric]: ProviderMetricConfig<
      HKCategoryTypeIdentifier | HKQuantityTypeIdentifier,
      M
    >;
  }> = {
    illness: {
      identifiers: [
        HKCategoryTypeIdentifier.fever,
        HKCategoryTypeIdentifier.chills,
        HKCategoryTypeIdentifier.diarrhea,
        HKCategoryTypeIdentifier.headache,
        HKCategoryTypeIdentifier.fatigue,
        HKCategoryTypeIdentifier.coughing,
      ],
      transform: (data: AppleIllnessData): IllnessDataPoint[] => {
        return this.mapIllnessToDatapoint(data);
      },
    },
    sleep: {
      identifiers: [HKCategoryTypeIdentifier.sleepAnalysis],
      transform: (data: AppleSleepData): SleepDataPoint[] => {
        const sleepAnalysis = data[HKCategoryTypeIdentifier.sleepAnalysis];
        return this.mapSleepAnalysisToDatapoint(sleepAnalysis);
      },
    },
  };

  /**
   * Mapping of Apple HealthKit sleep stages to internal sleep stage types
   */
  private readonly sleepStageMapping: Record<HKCategoryValueSleepAnalysis, SleepStageType> = {
    [HKCategoryValueSleepAnalysis.awake]: 'awake',
    [HKCategoryValueSleepAnalysis.asleepCore]: 'core',
    [HKCategoryValueSleepAnalysis.asleepDeep]: 'deep',
    [HKCategoryValueSleepAnalysis.asleepREM]: 'rem',
    [HKCategoryValueSleepAnalysis.asleepUnspecified]: 'unspecified',
    [HKCategoryValueSleepAnalysis.inBed]: 'inBed',
  };

  /**
   * Mapping of Apple HealthKit illness types to internal illness types
   */
  private readonly illnessTypeMapping: Record<keyof AppleIllnessData, IllnessType> = {
    [HKCategoryTypeIdentifier.fever]: 'fever',
    [HKCategoryTypeIdentifier.chills]: 'chills',
    [HKCategoryTypeIdentifier.diarrhea]: 'diarrhea',
    [HKCategoryTypeIdentifier.headache]: 'headache',
    [HKCategoryTypeIdentifier.fatigue]: 'fatigue',
    [HKCategoryTypeIdentifier.coughing]: 'cough',
  } as const;

  /**
   * Mapping of severity values from Apple HealthKit to internal severity scale
   */
  private readonly severityMapping: Record<number, Severity> = {
    0: 0,
    1: 1,
    2: 2,
    3: 3,
    4: 4,
  };

  /**
   * Initializes the Apple Health provider
   * @returns {Promise<boolean>} Success status of initialization
   */
  async init(): Promise<void> {
    const available = await this.isAvailable();
    if (!available) {
      throw new HealthDataError(
        'PROVIDER_UNAVAILABLE',
        'HealthKit is not available on this device',
      );
    }
  }

  /**
   * Checks if Apple HealthKit is available on the device
   * @returns {Promise<boolean>} Whether HealthKit is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      return await Healthkit.isHealthDataAvailable();
    } catch (error) {
      throw new HealthDataError('PROVIDER_UNAVAILABLE', {
        cause: error,
        message: 'Failed to check HealthKit availability',
      });
    }
  }

  /**
   * Requests permissions for specified health metrics
   * @param {HealthMetric[]} metrics - Array of metrics to request permissions for
   * @returns {Promise<boolean>} Whether permissions were granted
   */
  async requestPermissions(metrics: readonly HealthMetric[]): Promise<void> {
    const supportedMetrics = metrics.filter((metric) => this.metricMapping[metric] !== undefined);

    if (supportedMetrics.length === 0) {
      throw new HealthDataError('INVALID_METRIC', 'No supported metrics requested');
    }

    const requiredPermissions = supportedMetrics.flatMap((metric) => {
      const mapping = this.metricMapping[metric];
      return mapping?.identifiers ?? [];
    });

    try {
      await Healthkit.requestAuthorization([...new Set(requiredPermissions)]);
    } catch (error) {
      throw new HealthDataError('PERMISSION_DENIED', {
        cause: error,
        message: 'Failed to request HealthKit permissions',
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
    const mapping = this.metricMapping[metric];
    if (!mapping) {
      throw new HealthDataError('INVALID_METRIC', `Metric ${metric} not supported by ${this.name}`);
    }

    try {
      const dataMap: Partial<Record<HKCategoryTypeIdentifier, readonly HKCategorySample[]>> = {};

      await Promise.all(
        mapping.identifiers.map(async (identifier) => {
          if (this.isCategoryIdentifier(identifier)) {
            dataMap[identifier] = await Healthkit.queryCategorySamples(identifier, {
              from: startDate,
              to: endDate,
            });
          }
        }),
      );

      const transformedValue = mapping.transform(dataMap);

      return {
        timestamp: new Date(),
        type: 'category',
        value: transformedValue,
      };
    } catch (error) {
      throw new HealthDataError('DATA_FETCH_ERROR', {
        cause: error,
        message: 'Failed to fetch Apple Health data',
      });
    }
  }

  /**
   * Sets up real-time data observers for health metrics
   * @param {Function} callback - Callback function for data updates
   * @param {Date} startDate - Start date for data monitoring
   * @param {Date} endDate - End date for data monitoring
   * @returns {Promise<() => void>} Cleanup function for observers
   */
  async onData(
    callback: (metric: HealthMetric, data: HealthMetricSample<HealthMetric>) => void,
    startDate: Date,
    endDate: Date,
  ): Promise<() => void> {
    const cleanupFunctions: (() => Promise<void>)[] = [];

    for (const [metric, mapping] of Object.entries(this.metricMapping)) {
      for (const identifier of mapping.identifiers) {
        if (this.isCategoryIdentifier(identifier)) {
          const unsubscribe = await Healthkit.subscribeToChanges(identifier, async () => {
            const data = await this.getData(metric as HealthMetric, startDate, endDate);
            callback(metric as HealthMetric, data);
          });
          cleanupFunctions.push(async () => {
            await unsubscribe();
          });
        }
      }
    }

    return () => {
      cleanupFunctions.forEach((cleanup) => {
        cleanup().catch((error) => {
          throw new HealthDataError(
            'CLEANUP_ERROR',
            'Failed to cleanup observers of Apple Health data, ' + error,
          );
        });
      });
    };
  }

  /**
   * Transforms sleep analysis data from Apple HealthKit into standardized sleep data points
   * @param {HKCategorySample[]} sleepAnalysis - Raw sleep analysis data
   * @returns {SleepDataPoint[]} Transformed sleep data points
   */
  private mapSleepAnalysisToDatapoint(sleepAnalysis: HKCategorySample[]): SleepDataPoint[] {
    if (!sleepAnalysis.length) return [];

    const stages = this.createSortedSleepStages(sleepAnalysis);
    if (stages.length === 0) return [];

    return this.createSleepSessions(stages);
  }

  /**
   * Creates sorted sleep stages from raw sleep analysis data
   * @param {HKCategorySample[]} sleepAnalysis - Raw sleep analysis data
   * @returns {SleepStage[]} Sorted sleep stages
   */
  private createSortedSleepStages(sleepAnalysis: HKCategorySample[]): SleepStage[] {
    return sleepAnalysis
      .map((sample) => ({
        type: this.sleepStageMapping[sample.value as HKCategoryValueSleepAnalysis],
        start: sample.startDate,
        end: sample.endDate,
      }))
      .filter((stage): stage is SleepStage => stage !== undefined)
      .sort((a, b) => a.start.getTime() - b.start.getTime());
  }

  /**
   * Creates sleep sessions from sorted sleep stages
   * @param {SleepStage[]} stages - Sorted sleep stages
   * @returns {SleepDataPoint[]} Sleep sessions
   */
  private createSleepSessions(stages: SleepStage[]): SleepDataPoint[] {
    const sessions: SleepDataPoint[] = [];
    if (!stages[0]) return sessions;

    let currentStages = [stages[0]];
    let sessionStart = stages[0].start;

    for (let i = 1; i < stages.length; i++) {
      const currentStage = stages[i];
      const previousStage = stages[i - 1];

      if (!currentStage || !previousStage) continue;

      const gapMinutes = (currentStage.start.getTime() - previousStage.end.getTime()) / (1000 * 60);

      if (gapMinutes <= this.MAX_GAP_MINUTES) {
        currentStages.push(currentStage);
      } else {
        if (currentStages.length > 0) {
          this.addSleepSession(sessions, currentStages, sessionStart);
        }
        currentStages = [currentStage];
        sessionStart = currentStage.start;
      }
    }

    if (currentStages.length > 0) {
      this.addSleepSession(sessions, currentStages, sessionStart);
    }

    return sessions;
  }

  /**
   * Adds a sleep session to the sessions array
   * @param {SleepDataPoint[]} sessions - Array of sleep sessions
   * @param {SleepStage[]} stages - Stages in the current session
   * @param {Date} sessionStart - Start time of the session
   */
  private addSleepSession(
    sessions: SleepDataPoint[],
    stages: SleepStage[],
    sessionStart: Date,
  ): void {
    const firstStage = stages[0];
    if (!firstStage) return;
    const sessionEnd = stages.reduce(
      (latestEnd, stage) => (stage.end.getTime() > latestEnd.getTime() ? stage.end : latestEnd),
      firstStage.end,
    );

    sessions.push({
      source: this.id,
      stages,
      start: sessionStart,
      end: sessionEnd,
    });
  }

  /**
   * Transforms illness data from Apple HealthKit into standardized illness data points
   * @param {AppleIllnessData} illnessData - Raw illness data
   * @returns {IllnessDataPoint[]} Transformed illness data points
   */
  private mapIllnessToDatapoint(illnessData: AppleIllnessData): IllnessDataPoint[] {
    return (Object.entries(illnessData) as [keyof AppleIllnessData, HKCategorySample[]][]).flatMap(
      ([identifier, samples]) => {
        return samples.map((sample) => {
          return {
            source: this.id,
            type: this.illnessTypeMapping[identifier],
            severity: this.severityMapping[sample.value] ?? 0,
            start: sample.startDate,
            end: sample.endDate,
          };
        });
      },
    );
  }

  /**
   * Checks if an identifier is a category identifier
   * @param {HKCategoryTypeIdentifier | HKQuantityTypeIdentifier} identifier - The identifier to check
   * @returns {boolean} Whether the identifier is a category identifier
   */
  private isCategoryIdentifier(
    identifier: HKCategoryTypeIdentifier | HKQuantityTypeIdentifier,
  ): identifier is HKCategoryTypeIdentifier {
    return identifier.includes('Category');
  }

  /**
   * Gets the list of metrics supported by this provider
   * @returns {HealthMetric[]} Array of supported metrics
   */
  getSupportedMetrics(): HealthMetric[] {
    return Object.keys(this.metricMapping) as HealthMetric[];
  }

  /**
   * Cleans up any resources used by the provider
   * @returns {Promise<void>}
   */
  async cleanUp(): Promise<void> {
    try {
      this.observers.forEach((unsubscribe) => unsubscribe());
      this.observers.clear();
    } catch (error) {
      throw new HealthDataError('CLEANUP_ERROR', {
        cause: error,
        message: 'Failed to cleanup Apple Health provider',
      });
    }
  }
}
