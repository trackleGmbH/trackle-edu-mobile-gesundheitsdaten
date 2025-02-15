import { useCallback } from 'react';
import { useAtomValue, useSetAtom } from 'jotai';

import { TrackleError } from '#app/com/errors';
import { AppStore } from '#app/data/store/app-store.ts';
import { useCycles } from '#app/data/sync/cycles/cycles-sync-state.ts';
import { getService } from '#app/service';
import { HealthDataState } from '#features/healthData/healthData.types.ts';
import { HEALTH_METRICS } from '#features/healthData/healthDataConstants.ts';
import { HealthDatServiceLoc } from '#features/healthData/healthDataService.ts';

/**
 * Initial state for health data
 * @type {HealthDataState}
 */
const initialState: HealthDataState = {
  healthData: {
    stress: {
      timestamp: new Date(),
      value: [
        {
          source: 'test',
          severity: 3,
          start: new Date(),
          end: new Date(),
        },
        {
          source: 'test',
          severity: 1,
          start: new Date(),
          end: new Date(),
        },
      ],
      type: 'category',
    },
  },
  isLoading: false,
  error: null,
};

/**
 * Persistent atom for storing health state using MMKV storage
 * @type {Atom<HealthDataState>}
 */
const HealthState$ = AppStore.atomWithMMKV<HealthDataState>('HEALTH_STATE', initialState);

/**
 * Hook to access the current health state
 * @returns {HealthDataState} Current health state
 */
export const useHealthState = () => useAtomValue(HealthState$);

/**
 * Hook providing actions to manage health state
 * @returns {Object} Object containing the following health state actions:
 * - refreshData: Function to fetch latest health data
 * - subscribeToHealthUpdates: Function to set up real-time updates
 * - deleteHealthData: Function to reset health data to initial state
 */
export const useHealthStateActions = () => {
  const setHealthState = useSetAtom(HealthState$);
  const cycles = useCycles();

  /**
   * Refreshes health data from all providers
   * @returns {Promise<void>}
   */
  const refreshData = async () => {
    setHealthState((prev) => ({ ...prev, isLoading: true }));
    try {
      const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
      let startDay = new Date(new Date().getTime() - THIRTY_DAYS_MS);

      if (cycles.length >= 2) {
        const secondLastCycle = cycles[cycles.length - 2];
        if (secondLastCycle?.cycleBegin) {
          startDay = new Date(secondLastCycle.cycleBegin);
        }
      }

      const service = getService(HealthDatServiceLoc);
      const result = await service.syncHealthData(HEALTH_METRICS, startDay);
      setHealthState(result);
    } catch (error) {
      if (TrackleError.isTrackleError(error)) {
        setHealthState((prev) => ({
          ...prev,
          error: error.message,
          isLoading: false,
        }));
      }
    }
  };

  /**
   * Sets up real-time health data updates from providers
   * @returns {Function} Cleanup function to unsubscribe from updates
   */
  const subscribeToHealthUpdates = useCallback(() => {
    const service = getService(HealthDatServiceLoc);

    return service.subscribeToHealthUpdates((metric, newData) => {
      setHealthState((prevState) => {
        const existing = prevState.healthData[metric];
        const mergedData = service.mergeMetricData(existing, newData);

        return {
          ...prevState,
          healthData: {
            ...prevState.healthData,
            [metric]: mergedData,
          },
        };
      });
    });
  }, []);

  /**
   * Resets health data to initial state
   * @returns {void}
   */
  const deleteHealthData = useCallback(() => {
    setHealthState(initialState);
  }, []);

  return {
    refreshData,
    subscribeToHealthUpdates,
    deleteHealthData,
  };
};

/**
 * Combined hook providing both health state and actions
 * @returns {[HealthDataState, ReturnType<typeof useHealthStateActions>]} Tuple containing state and actions
 * @example
 * const [healthState, healthActions] = useHealth();
 * // Access state: healthState.healthData
 * // Use actions: healthActions.refreshData()
 */
export const useHealth = () => [useHealthState(), useHealthStateActions()] as const;
