import { HEALTH_METRICS } from '#features/healthData/healthDataConstants.ts';

/**
 * Core metric types supported by the health data system
 */
export type HealthMetric = (typeof HEALTH_METRICS)[number];

/**
 * Severity levels for health conditions
 * 0 = no severity
 * 1 = mild
 * 2 = moderate
 * 3 = severe
 * 4 = very severe
 */
export type Severity = 0 | 1 | 2 | 3 | 4;

// ----------------
// Sleep Data Types
// ----------------

/**
 * Types of sleep stages that can be tracked
 */
export type SleepStageType = 'awake' | 'core' | 'deep' | 'rem' | 'unspecified' | 'inBed';

/**
 * Individual sleep stage within a sleep session
 */
export interface SleepStage {
  type: SleepStageType;
  start: Date;
  end: Date;
}

/**
 * Complete sleep session data point
 */
export interface SleepDataPoint {
  stages: SleepStage[];
  start: Date;
  end: Date;
  source: string;
}

// ------------------
// Illness Data Types
// ------------------

/**
 * Types of illnesses that can be tracked
 */
export type IllnessType = 'cough' | 'diarrhea' | 'headache' | 'fatigue' | 'fever' | 'chills';

/**
 * Individual illness episode data point
 */
export interface IllnessDataPoint {
  type: IllnessType;
  severity: Severity;
  start: Date;
  end: Date;
  source: string;
}

// -----------------
// Stress Data Types
// -----------------

/**
 * Individual stress episode data point
 */
export interface StressDataPoint {
  severity: Severity;
  start: Date;
  end: Date;
  source: string;
}

// ----------------------
// Health Data Structure
// ----------------------

/**
 * Mapping of health metrics to their respective data point types
 */
export interface HealthMetricValueMap {
  stress: StressDataPoint[];
  sleep: SleepDataPoint[];
  illness: IllnessDataPoint[];
}

/**
 * Sample of health metric data at a point in time
 */
export interface HealthMetricSample<M extends HealthMetric> {
  value: HealthMetricValueMap[M];
  type: 'quantity' | 'category';
  timestamp: Date;
}

/**
 * Complete health data structure containing all metrics
 */
export type HealthData = {
  [M in HealthMetric]?: HealthMetricSample<M>;
};

/**
 * State structure for health data management
 */
export interface HealthDataState {
  healthData: HealthData;
  isLoading: boolean;
  error: string | null;
}

// ----------------
// Provider Types
// ----------------

/**
 * State structure for provider management
 */
export interface ProviderState {
  enabledProviders: string[];
  error: string | null;
}

/**
 * Mapping configuration for provider-specific metric identifiers
 */
export interface ProviderMetricConfig<ProviderMetricIdentifier, M extends HealthMetric> {
  identifiers: ProviderMetricIdentifier[];
  transform: (data: any) => HealthMetricValueMap[M];
}

/**
 * Provider configuration for data collection capabilities
 */
export interface HealthProviderConfig {
  polling: {
    supported: boolean;
    minIntervalMs: number;
  };
  realtime: {
    supported: boolean;
  };
}

/**
 * Interface for health data providers
 * Defines required functionality for data collection and management
 */
export interface HealthDataProvider<ProviderMetricIdentifier> {
  readonly id: string;
  readonly name: string;
  readonly priority: number;
  readonly metricMapping: Partial<{
    [M in HealthMetric]: ProviderMetricConfig<ProviderMetricIdentifier, M>;
  }>;
  readonly config: HealthProviderConfig;

  /**
   * Checks if the provider is available on the current device
   */
  isAvailable(): Promise<boolean>;

  /**
   * Initializes the provider (e.g., OAuth setup)
   * @returns True if initialization succeeded or if already initialized
   */
  init(): Promise<void>;

  /**
   * Requests permissions for specified metrics
   * @returns True if permissions were granted or if already granted
   */
  requestPermissions(metrics: readonly HealthMetric[]): Promise<void>;

  /**
   * Retrieves data for a specific metric within a time range
   */
  getData<M extends HealthMetric>(
    metric: M,
    startDate: Date,
    endDate: Date,
  ): Promise<HealthMetricSample<M>>;

  /**
   * Sets up real-time data updates
   * @returns Cleanup function to stop updates
   */
  onData(
    callback: (metric: HealthMetric, data: HealthMetricSample<HealthMetric>) => void,
    startDate: Date,
    endDate: Date,
  ): Promise<() => void>;

  /**
   * Gets list of metrics supported by this provider
   */
  getSupportedMetrics(): HealthMetric[];

  /**
   * Cleans up provider resources
   */
  cleanUp(): Promise<void>;
}
