import { useCallback } from 'react';
import { router } from 'expo-router';
import { msg, Trans as T__ } from '@lingui/macro';
import { FlashList } from '@shopify/flash-list';

import { T } from '@tr/ui';

import { Screen } from '#app/ui/Screen.tsx';
import { HealthDataProvider, HealthMetric } from '#features/healthData/healthData.types.ts';
import { HEALTH_METRICS } from '#features/healthData/healthDataConstants.ts';
import {
  useHealthProviderActions,
  useHealthProviderState,
} from '#features/healthData/HealthProviderState.ts';
import { useHealthState } from '#features/healthData/HealthState.ts';
import {
  HealthDataControlCard,
  HealthDataNavCard,
} from '#features/healthData/UI/healthDataControlCard.tsx';
import { OBScreen as OBS, OnboardingPage } from '#features/ob/ui';

const healthDataMessage = msg`Du kannst Gesundheitsdaten aus anderen Gesundheitsplatformen und Apps importieren, um deine Zyklusdaten zu bereichern. Vorrangig werden die Daten verwendet um Hinweise auf Störfaktoren zu finden.`;

/**
 * Screen component for managing health data import settings
 * Displays available health data platforms and metrics that can be imported
 */
export function HealthDataSettingsScreen() {
  const { getProviders } = useHealthProviderActions();
  const { error: providerError } = useHealthProviderState();
  const { error: healthDataError } = useHealthState();

  const handleBack = useCallback(() => {
    router.back();
  }, []);

  const providers = getProviders();

  return (
    <Screen backgroundType="tinted">
      <OnboardingPage transparentHeader={false}>
        <OBS.Header>
          <OBS.Header.Title className="text-center">
            <T__>Daten Importieren</T__>
          </OBS.Header.Title>
          <OBS.Header.Description>{healthDataMessage}</OBS.Header.Description>
        </OBS.Header>

        <OBS.Body>
          {/* Available Platforms Section */}
          <T.Bold className="text-center">
            <T__>Verfügbare Platformen</T__>
          </T.Bold>
          <FlashList<HealthDataProvider<any>>
            renderItem={({ item: provider }) => <HealthDataControlCard provider={provider} />}
            data={providers}
            estimatedItemSize={10}
          />

          {providerError && <T.Body className="text-center text-c-error">{providerError}</T.Body>}

          {/* Available Metrics Section */}
          <T.Bold className="text-center">
            <T__>Verfügbare Metriken</T__>
          </T.Bold>
          <FlashList<HealthMetric>
            renderItem={({ item: metric }) => <HealthDataNavCard metric={metric} />}
            data={HEALTH_METRICS}
            estimatedItemSize={10}
          />
        </OBS.Body>

        <OBS.Footer>
          <OBS.NextButton onPress={handleBack} loading={false}>
            <T__>Zurück</T__>
          </OBS.NextButton>
        </OBS.Footer>
      </OnboardingPage>
    </Screen>
  );
}
