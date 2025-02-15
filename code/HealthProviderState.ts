import { useAtomValue, useSetAtom } from 'jotai';

import { TrackleError } from '#app/com/errors';
import { useAllCycles } from '#app/data/access/cycles';
import { AppStore } from '#app/data/store/app-store.ts';
import { getService } from '#app/service';
import { HealthDataProvider, ProviderState } from '#features/healthData/healthData.types.ts';
import { HealthProviderRegistryLoc } from '#features/healthData/healthProviderManager.ts';

/**
 * Initial state for health providers
 * @type {ProviderState}
 */
const initialState: ProviderState = {
  enabledProviders: [],
  error: null,
};

/**
 * Persistent atom for storing provider state using MMKV storage
 * Used to maintain provider settings across app restarts
 * @type {Atom<ProviderState>}
 */
export const ProviderState$ = AppStore.atomWithMMKV<ProviderState>(
  'HEALTH_PROVIDER_STATE',
  initialState,
);

/**
 * Hook to access the current provider state
 * @returns {ProviderState} Current provider state containing enabled providers and error information
 */
export const useHealthProviderState = () => useAtomValue(ProviderState$);

/**
 * Hook providing actions to manage health provider state
 * @returns {Object} Object containing the following provider state actions:
 * - toggleProvider: Function to enable/disable a provider
 * - getProviders: Function to get all available providers
 * - startPolling: Function to begin data polling from enabled providers
 */
export const useHealthProviderActions = () => {
  const setState = useSetAtom(ProviderState$);
  const registry = getService(HealthProviderRegistryLoc);
  const { data: cycles } = useAllCycles();

  /**
   * Calculates the start date for data fetching
   * Uses either the second-to-last cycle begin date or defaults to 30 days ago
   * @returns {Date} The calculated start date for data fetching
   */
  const getStartDate = (): Date => {
    const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
    const defaultStartDate = new Date(new Date().getTime() - THIRTY_DAYS_MS);

    if (!cycles || cycles.length < 2) {
      return defaultStartDate;
    }

    const secondLastCycle = cycles[cycles.length - 2];
    return secondLastCycle?.cycleBegin ? new Date(secondLastCycle.cycleBegin) : defaultStartDate;
  };

  /**
   * Starts polling for data from all enabled providers
   * Uses the calculated start date to determine the timeframe for data collection
   * @returns {void}
   */
  const startPolling = () => {
    const startDate = getStartDate();
    registry.startPollingEnabledProviders(startDate);
  };

  /**
   * Toggles a provider's enabled state and updates the provider registry
   * @param {HealthDataProvider<any>} provider - The health data provider to toggle
   * @param {boolean} enabled - Whether to enable or disable the provider
   * @returns {Promise<void>}
   */
  const toggleProvider = async (
    provider: HealthDataProvider<any>,
    enabled: boolean,
  ): Promise<void> => {
    if (enabled) {
      const startDate = getStartDate();
      try {
        await registry.enableProvider(provider.id, startDate);
        setState((prev) => ({
          ...prev,
          error: null,
          enabledProviders: [...prev.enabledProviders, provider.id],
        }));
      } catch (error) {
        if (TrackleError.isTrackleError(error)) {
          setState((prev) => ({
            ...prev,
            error: error.message,
          }));
        }
      }
    } else {
      try {
        await registry.disableProvider(provider.id);
        setState((prev) => ({
          ...prev,
          error: null,
          enabledProviders: prev.enabledProviders.filter((p) => p !== provider.id),
        }));
      } catch (error) {
        if (TrackleError.isTrackleError(error)) {
          setState((prev) => ({
            ...prev,
            error: error.message,
          }));
        }
      }
    }
  };

  /**
   * Gets the list of all available health data providers
   * @returns {HealthDataProvider<any>[]} Array of available providers that can be enabled
   * @throws {TrackleError} When provider retrieval fails
   */
  const getProviders = () => {
    try {
      return registry.getAllProviders().filter((p) => p.isAvailable());
    } catch (error) {
      if (TrackleError.isTrackleError(error)) {
        setState((prev) => ({
          ...prev,
          error: error.message,
        }));
      }
    }
  };

  return {
    toggleProvider,
    getProviders,
    startPolling,
  };
};
