import { useCallback, useEffect, useState } from 'react';
import { Switch } from 'react-native';
import { router } from 'expo-router';
import { msg, Trans as T__ } from '@lingui/macro';

import { B, T, themeVars } from '@tr/ui';

import { TrackleError } from '#app/com/errors';
import { HealthDataProvider, HealthMetric } from '#features/healthData/healthData.types.ts';
import {
  useHealthProviderActions,
  useHealthProviderState,
} from '#features/healthData/HealthProviderState.ts';
import { SettingsCard } from '#features/settings/ui/components/SettingsCard.tsx';

/**
 * Card component for controlling health data provider settings
 * Displays a provider's name with a toggle switch to enable/disable data collection
 *
 * @component
 * @param {HealthDataProvider<any>} provider - Health data provider to control
 * @example
 * <HealthDataControlCard provider={appleHealthProvider} />
 */
export function HealthDataControlCard(props: { provider: HealthDataProvider<any> }) {
  const [isLoading, setIsLoading] = useState(false);
  const { toggleProvider } = useHealthProviderActions();
  const { enabledProviders } = useHealthProviderState();

  /**
   * Handles toggling the provider's enabled state
   * Shows loading state during the toggle operation
   */
  const onToggleProvider = async () => {
    setIsLoading(true);
    await toggleProvider(props.provider, !enabledProviders.includes(props.provider.id));
    setIsLoading(false);
  };

  return (
    <SettingsCard status={isLoading ? 'loading' : 'none'}>
      <SettingsCard.Title title={props.provider.name}>
        <Switch
          value={enabledProviders.includes(props.provider.id)}
          thumbColor={
            enabledProviders.includes(props.provider.id) ? 'white' : themeVars.colors.sec.DEFAULT
          }
          trackColor={{
            false: themeVars.colors.plain.DEFAULT,
            true: themeVars.colors.sec.DEFAULT,
          }}
          disabled={isLoading}
          onValueChange={onToggleProvider}
        />
      </SettingsCard.Title>
    </SettingsCard>
  );
}

/**
 * Navigation card component for accessing detailed health metric data
 * Routes to a preview screen for the specified health metric
 *
 * @component
 * @param {HealthMetric} metric - Health metric to display and navigate to
 * @example
 * <HealthDataNavCard metric="stress" />
 */
export function HealthDataNavCard(props: { metric: HealthMetric }) {
  /**
   * Navigates to the health data preview screen for the specified metric
   */
  const route = () => {
    router.push({
      pathname: '/health-data-preview',
      params: { metric: props.metric },
    });
  };

  return (
    <SettingsCard onPress={route}>
      <SettingsCard.Title title={msg`${props.metric}`}>
        <B.Icon name="ChevronRight" size={6} className={'color-base'} />
      </SettingsCard.Title>
    </SettingsCard>
  );
}
