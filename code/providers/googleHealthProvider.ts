import {
  getSdkStatus,
  initialize,
  readRecords,
  requestPermission,
  SdkAvailabilityStatus,
} from 'react-native-health-connect';
import type { ReadRecordsResult } from 'react-native-health-connect/src/types';
import type { RecordType } from 'react-native-health-connect/src/types/records.types.ts';

import {
  HealthDataProvider,
  HealthMetric,
  HealthMetricSample,
  HealthMetricValueMap,
  IllnessDataPoint,
  IllnessType,
  ProviderMetricConfig,
  Severity,
  SleepDataPoint,
  SleepStageType,
} from '#features/healthData/healthData.types.ts';
import { HealthDataError } from '#features/healthData/healthDataErrors.ts';

/**
 * Interface for sleep data from Google Health Connect
 */
interface GoogleSleepData {
  ['SleepSession']: ReadRecordsResult<'SleepSession'>;
}

/**
 * Interface for illness-related data from Google Health Connect
 */
interface GoogleIllnessData {
  ['BodyTemperature']: ReadRecordsResult<'BodyTemperature'>;
}

/**
 * Provider implementation for Google Health Connect integration.
 * Handles data fetching and transformation of health data from Google Health Connect.
 *
 * @implements {HealthDataProvider<RecordType>}
 */
export class GoogleHealthProvider implements HealthDataProvider<RecordType> {
  readonly id = 'google-health';
  readonly name = 'Google Health';
  readonly priority = 10;

  readonly config = {
    polling: {
      supported: true,
      minIntervalMs: 1000 * 60, // 1 minute
    },
    realtime: {
      supported: false,
    },
  };

  private initialized = false;
  private readonly MAX_FEVER_GAP_MINUTES = 1440; // 24 hours between readings to consider it the same fever episode

  /**
   * Mapping configuration for transforming Google Health data into standardized metrics
   */
  readonly metricMapping: Partial<{
    [M in HealthMetric]: ProviderMetricConfig<RecordType, M>;
  }> = {
    sleep: {
      identifiers: ['SleepSession'],
      transform: (data: GoogleSleepData): SleepDataPoint[] => {
        return data.SleepSession.records.map((record) => ({
          source: this.id,
          stages:
            record.stages?.map((stage) => ({
              type: this.sleepStageMapping[stage.stage] ?? 'unspecified',
              start: new Date(stage.startTime),
              end: new Date(stage.endTime),
            })) ?? [],
          start: new Date(record.startTime),
          end: new Date(record.endTime),
        }));
      },
    },
    illness: {
      identifiers: ['BodyTemperature'],
      transform: (data: GoogleIllnessData): IllnessDataPoint[] => {
        return this.processTemperatureRecords(data.BodyTemperature.records);
      },
    },
  };

  /**
   * Mapping of Google Health sleep stages to internal sleep stage types
   */
  private readonly sleepStageMapping: Record<number, SleepStageType> = {
    1: 'awake',
    2: 'unspecified',
    3: 'awake',
    4: 'unspecified',
    5: 'deep',
    6: 'rem',
    7: 'awake',
  };

  /**
   * Mapping of body temperature thresholds to severity levels
   */
  private readonly bodyTemperatureSeverityMapping: Partial<Record<Severity, number>> = {
    0: 38,
    1: 38.5,
    2: 39.5,
    3: 40.5,
  };

  /**
   * Determines severity level based on body temperature
   * @param {number} bodyTemperature - Temperature in Celsius
   * @returns {Severity} Corresponding severity level
   */
  private getSeverityFromBodyTemperature = (bodyTemperature: number): Severity => {
    for (const [severityStr, threshold] of Object.entries(this.bodyTemperatureSeverityMapping)) {
      if (bodyTemperature < threshold) {
        return Number(severityStr) as Severity;
      }
    }
    return 4 as Severity;
  };

  /**
   * Processes temperature records to identify illness episodes
   * @param {ReadRecordsResult<'BodyTemperature'>['records']} records - Temperature records
   * @returns {IllnessDataPoint[]} Identified illness episodes
   */
  private processTemperatureRecords(
    records: ReadRecordsResult<'BodyTemperature'>['records'],
  ): IllnessDataPoint[] {
    if (!records.length) return [];

    const sortedRecords = [...records].sort(
      (a, b) => new Date(a.time).getTime() - new Date(b.time).getTime(),
    );

    const illnessEpisodes: IllnessDataPoint[] = [];
    let currentSeverities: number[] = [
      this.getSeverityFromBodyTemperature(sortedRecords[0]!.temperature.inCelsius),
    ];
    let episodeStart = new Date(sortedRecords[0]!.time);
    let lastRecordTime = new Date(sortedRecords[0]!.time);

    for (let i = 1; i < sortedRecords.length; i++) {
      const currentRecord = sortedRecords[i]!;
      const currentTime = new Date(currentRecord.time);
      const gapMinutes = (currentTime.getTime() - lastRecordTime.getTime()) / (1000 * 60);
      const currentSeverity = this.getSeverityFromBodyTemperature(
        currentRecord.temperature.inCelsius,
      );

      if (gapMinutes <= this.MAX_FEVER_GAP_MINUTES) {
        currentSeverities.push(currentSeverity);
      } else {
        this.addIllnessEpisode(
          'fever',
          illnessEpisodes,
          currentSeverities,
          episodeStart,
          lastRecordTime,
        );
        currentSeverities = [currentSeverity];
        episodeStart = currentTime;
      }

      lastRecordTime = currentTime;
    }

    this.addIllnessEpisode(
      'fever',
      illnessEpisodes,
      currentSeverities,
      episodeStart,
      lastRecordTime,
    );

    return illnessEpisodes;
  }

  /**
   * Adds an illness episode to the episodes array
   * @param illnessType - Type of illness
   * @param {IllnessDataPoint[]} episodes - Array of illness episodes
   * @param {number[]} severities - Array of severity values
   * @param {Date} start - Start time of the episode
   * @param {Date} end - End time of the episode
   */
  private addIllnessEpisode(
    illnessType: IllnessType,
    episodes: IllnessDataPoint[],
    severities: number[],
    start: Date,
    end: Date,
  ): void {
    if (severities.length > 0) {
      const averageSeverity = Math.round(
        severities.reduce((sum, sev) => sum + sev, 0) / severities.length,
      ) as Severity;

      episodes.push({
        source: this.id,
        type: illnessType,
        severity: averageSeverity,
        start,
        end,
      });
    }
  }

  /**
   * Checks if Google Health Connect is available
   */
  async isAvailable(): Promise<boolean> {
    try {
      return (await getSdkStatus()) === SdkAvailabilityStatus.SDK_AVAILABLE;
    } catch (error) {
      throw new HealthDataError('PROVIDER_UNAVAILABLE', {
        cause: error,
        message: 'Failed to check Google Health Connect availability',
      });
    }
  }

  /**
   * Initializes the Google Health Connect SDK
   */
  async init(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      const available = await this.isAvailable();
      if (!available) {
        throw new HealthDataError(
          'PROVIDER_UNAVAILABLE',
          'Google Health Connect is not available on this device',
        );
      }

      const status = await initialize();
      if (!status) {
        throw new HealthDataError(
          'PROVIDER_INIT_FAILED',
          'Failed to initialize Google Health Connect',
        );
      }

      this.initialized = true;
    } catch (error) {
      if (error instanceof HealthDataError) {
        throw error;
      }
      throw new HealthDataError('PROVIDER_INIT_FAILED', {
        cause: error,
        message: 'Failed to initialize Google Health Connect',
      });
    }
  }

  /**
   * Requests permissions for specified health metrics
   * @param {readonly HealthMetric[]} metrics - Array of metrics to request permissions for
   * @returns {Promise<boolean>} Whether permissions were granted
   */
  async requestPermissions(metrics: readonly HealthMetric[]): Promise<void> {
    const supportedMetrics = metrics.filter((metric) => this.metricMapping[metric] !== undefined);

    if (supportedMetrics.length === 0 || !this.initialized) {
      throw new HealthDataError(
        'INVALID_METRIC',
        'No supported metrics requested or provider not initialized',
      );
    }

    try {
      const requiredPermissions = supportedMetrics.flatMap((metric) => {
        const mapping = this.metricMapping[metric];
        if (!mapping) {
          throw new HealthDataError(
            'INVALID_METRIC',
            `Metric ${metric} not supported by ${this.name}`,
          );
        }
        return mapping.identifiers.map((identifier) => ({
          accessType: 'read' as const,
          recordType: identifier,
        }));
      });

      const allowedPermissions = await requestPermission(requiredPermissions);
      if (allowedPermissions.length === 0) {
        throw new HealthDataError(
          'PERMISSION_DENIED',
          'User denied Google Health Connect permissions',
        );
      }
    } catch (error) {
      if (error instanceof HealthDataError) {
        throw error;
      }
      throw new HealthDataError('PERMISSION_DENIED', {
        cause: error,
        message: 'Failed to request Google Health Connect permissions',
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
    if (!this.initialized) {
      throw new HealthDataError('PROVIDER_UNAVAILABLE', 'Google Health Connect not initialized');
    }

    const mapping = this.metricMapping[metric];
    if (!mapping) {
      throw new HealthDataError('INVALID_METRIC', `Metric ${metric} not supported by ${this.name}`);
    }

    try {
      const dataMap: Partial<Record<RecordType, ReadRecordsResult<RecordType>>> = {};
      await Promise.all(
        mapping.identifiers.map(async (identifier) => {
          dataMap[identifier] = await readRecords(identifier, {
            timeRangeFilter: {
              operator: 'between',
              startTime: startDate.toISOString(),
              endTime: endDate.toISOString(),
            },
          });
        }),
      );

      const transformedValue: HealthMetricValueMap[M] = mapping.transform(dataMap as any);

      return {
        value: transformedValue,
        type: 'category',
        timestamp: new Date(),
      };
    } catch (error) {
      throw new HealthDataError('DATA_FETCH_ERROR', {
        cause: error,
        message: 'Failed to fetch Google Health Connect data',
      });
    }
  }

  /**
   * Not implemented as Google Health Connect doesn't support real-time data
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
   * No cleanup needed for Google Health Connect
   */
  async cleanUp(): Promise<void> {
    try {
      this.initialized = false;
    } catch (error) {
      throw new HealthDataError('CLEANUP_ERROR', {
        cause: error,
        message: 'Failed to cleanup Google Health Connect provider',
      });
    }
  }
}
