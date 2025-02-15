import { useCallback } from 'react';
import { router, useLocalSearchParams } from 'expo-router';
import { msg, Trans as T__ } from '@lingui/macro';
import { FlashList } from '@shopify/flash-list';

import { uiFormatDateFull, uiFormatDateWithMonth, uiFormatTime } from '@q/qom/qutils/date';
import { IconName } from '@tr/ui/src/svgs/icons';

import { Screen } from '#app/ui/Screen.tsx';
import {
  HealthMetric,
  IllnessDataPoint,
  IllnessType,
  Severity,
  SleepDataPoint,
  SleepStage,
  SleepStageType,
  StressDataPoint,
} from '#features/healthData/healthData.types.ts';
import { useHealthState } from '#features/healthData/HealthState.ts';
import { OBScreen as OBS, OnboardingPage } from '#features/ob/ui';
import { B, C, T, themeVars } from '#ui';

/**
 * Screen component for previewing different types of health data
 * Displays health metrics in a structured, visual format based on the metric type:
 * - Sleep data with stage visualization
 * - Illness data with severity indicators
 * - Stress level data with intensity visualization
 *
 * @component
 * @example
 * // Access via router with metric parameter
 * router.push({
 *   pathname: '/health-data-preview',
 *   params: { metric: 'sleep' }
 * });
 */
export function HealthDataPreviewScreen() {
  const { healthData } = useHealthState();
  const { metric } = useLocalSearchParams<{ metric: HealthMetric }>();

  /**
   * Handles navigation back to the previous screen
   */
  const handleBack = useCallback(() => {
    router.back();
  }, []);

  return (
    <Screen backgroundType="tinted">
      <OnboardingPage transparentHeader={false} className={'mt-0'}>
        <OBS.Header className={'w-full'}>
          {metric === 'sleep' && (
            <>
              <T.Title className="text-center">
                <T__>Schlafdaten</T__>
              </T.Title>
            </>
          )}
          {metric === 'illness' && (
            <>
              <T.Title className="text-center">
                <T__>Krankheitsdaten</T__>
              </T.Title>
            </>
          )}
          {metric === 'stress' && (
            <>
              <T.Title className="text-center">
                <T__>Stressdaten</T__>
              </T.Title>
            </>
          )}
        </OBS.Header>
        <OBS.Body>
          {metric === 'sleep' && (
            <>
              <SleepLegend />
              <FlashList<SleepDataPoint>
                data={healthData.sleep?.value.sort(
                  (a, b) => new Date(b.start).getTime() - new Date(a.start).getTime(),
                )}
                renderItem={({ item }) => <SleepCard dataPoint={item} />}
                estimatedItemSize={100}
              />
            </>
          )}
          {metric === 'illness' && (
            <>
              <SeverityLegend />
              <FlashList<IllnessDataPoint>
                data={healthData.illness?.value}
                renderItem={({ item }) => <IllnessCard dataPoint={item} />}
                estimatedItemSize={100}
              />
            </>
          )}
          {metric === 'stress' && (
            <>
              <SeverityLegend />
              <FlashList<StressDataPoint>
                data={healthData.stress?.value}
                renderItem={({ item }) => <StressCard dataPoint={item} />}
                estimatedItemSize={100}
              />
            </>
          )}
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

/**
 * Color mapping for different severity levels of health metrics
 * @type {Record<Severity, string>}
 */
const SEVERITY_COLOR_MAPPING: Record<Severity, string> = {
  0: themeVars.colors.illness.none,
  1: themeVars.colors.illness.mild,
  2: themeVars.colors.illness.moderate,
  3: themeVars.colors.illness.severe,
  4: themeVars.colors.illness.verySevere,
};

/**
 * Color mapping for different types of illnesses
 * @type {Record<IllnessType, string>}
 */
const ILLNESS_COLOR_MAPPING: Record<IllnessType, string> = {
  cough: themeVars.colors.illness.cough,
  diarrhea: themeVars.colors.illness.diarrhea,
  headache: themeVars.colors.illness.headache,
  fatigue: themeVars.colors.illness.fatigue,
  fever: themeVars.colors.illness.fever,
  chills: themeVars.colors.illness.chills,
};

/**
 * Icon mapping for different types of illnesses
 * @type {Record<IllnessType, IconName>}
 */
const ILLNESS_ICON_MAPPING: Record<IllnessType, IconName> = {
  cough: 'Wind',
  headache: 'Brain',
  fatigue: 'Activity',
  fever: 'Thermometer',
  chills: 'Bed',
  diarrhea: 'Wind',
};

/**
 * Color mapping for different sleep stages
 * @type {Record<SleepStageType, string>}
 */
const SLEEP_STAGE_COLORS: Record<SleepStageType, string> = {
  awake: themeVars.colors.sleep.awake,
  core: themeVars.colors.sleep.core,
  deep: themeVars.colors.sleep.deep,
  rem: themeVars.colors.sleep.rem,
  unspecified: themeVars.colors.sleep.unspecified,
  inBed: themeVars.colors.sleep.inBed,
};

/**
 * Component for displaying a stress data point with temporal and intensity information
 *
 * @component
 * @param {Object} props - Component properties
 * @param {StressDataPoint} props.dataPoint - Stress data to display
 */
function StressCard({ dataPoint }: { dataPoint: StressDataPoint }) {
  const date = uiFormatDateFull(dataPoint.start);
  const start = uiFormatTime(dataPoint.start);
  const end = uiFormatTime(dataPoint.end);
  const percentage = Math.max(dataPoint.severity * 25, 5);

  return (
    <C className="mx-auto my-2 w-full max-w-content overflow-hidden rounded-sm bg-white">
      <C className="p-4">
        <C className="mb-2 flex-row items-center justify-between">
          <T.Body>{date}</T.Body>
          <C className="flex-row items-center">
            <T.Body>{start} - </T.Body>
            <T.Body>{end}</T.Body>
          </C>
        </C>
        <C className="flex-row items-center gap-2">
          <B.Icon name="Brain" size={4} color={themeVars.colors.illness.headache} />
          <T.Body>
            <T__>Stress</T__>
          </T.Body>
        </C>
        <C
          className="mt-2 h-2 rounded-sm"
          style={{
            backgroundColor: SEVERITY_COLOR_MAPPING[dataPoint.severity],
            width: `${percentage}%`,
          }}
        />
        <C className={'mt-2'}>
          <T.CardSupport>
            <T__>{dataPoint.source ?? 'Unbekannt'}</T__>
          </T.CardSupport>
        </C>
      </C>
    </C>
  );
}

/**
 * Component for displaying an illness event with type, duration, and severity information
 *
 * @component
 * @param {Object} props - Component properties
 * @param {IllnessDataPoint} props.dataPoint - Illness data to display
 */
function IllnessCard({ dataPoint }: { dataPoint: IllnessDataPoint }) {
  const date = uiFormatDateFull(dataPoint.start);
  const start = uiFormatTime(dataPoint.start);
  const end = uiFormatTime(dataPoint.end);
  const percentage = Math.max(dataPoint.severity * 25, 5);

  return (
    <C className="mx-auto my-2 w-full max-w-content overflow-hidden rounded-sm bg-white">
      <C className="p-4">
        <C className="mb-2 flex-row items-center justify-between">
          <T.Body>{date}</T.Body>
          <C className="flex-row items-center">
            <T.Body>{start} - </T.Body>
            <T.Body>{end}</T.Body>
          </C>
        </C>
        <C>
          <C className="flex-row items-center gap-2">
            <B.Icon
              name={ILLNESS_ICON_MAPPING[dataPoint.type]}
              size={4}
              color={ILLNESS_COLOR_MAPPING[dataPoint.type]}
            />
            <T.Body>
              <T__>{dataPoint.type}</T__>
            </T.Body>
          </C>
          <C
            className="mt-2 h-2 rounded-sm"
            style={{
              backgroundColor: SEVERITY_COLOR_MAPPING[dataPoint.severity],
              width: `${percentage}%`,
            }}
          />
        </C>
        <C className={'mt-2'}>
          <T.CardSupport>
            <T__>{dataPoint.source ?? 'Unbekannt'}</T__>
          </T.CardSupport>
        </C>
      </C>
    </C>
  );
}

/**
 * Component for displaying a color-coded legend for sleep stages
 * Helps users interpret the sleep stage visualization
 *
 * @component
 */
function SleepLegend() {
  return (
    <C className="flex-row items-center justify-between rounded-sm bg-white p-4">
      {Object.entries(SLEEP_STAGE_COLORS).map(([stage, color]) => (
        <C key={stage} className="flex-col items-center gap-2">
          <C className="size-4 rounded-full" style={{ backgroundColor: color }} />
          <T.Body>
            <T__>{stage}</T__>
          </T.Body>
        </C>
      ))}
    </C>
  );
}

/**
 * Maps severity levels to localized display messages
 *
 * @param {Severity} severity - Numeric severity level (0-4)
 * @returns {MessageDescriptor} Localized message for severity level
 */
const severityMessage = (severity: Severity) => {
  switch (severity) {
    case 0:
      return msg`Keine`;
    case 1:
      return msg`Leicht`;
    case 2:
      return msg`Mittel`;
    case 3:
      return msg`Schwer`;
    case 4:
      return msg`Sehr schwer`;
  }
};

/**
 * Component for displaying a color-coded legend for severity levels
 * Used for both illness and stress data visualization
 *
 * @component
 */
function SeverityLegend() {
  return (
    <C className="flex-row items-center justify-between rounded-sm bg-white p-4">
      {Object.entries(SEVERITY_COLOR_MAPPING).map(([severity, color]) => (
        <C key={severity} className="flex-col items-center gap-2">
          <C className="size-4 rounded-full" style={{ backgroundColor: color }} />
          <T.Body>{severityMessage(parseInt(severity) as Severity)}</T.Body>
        </C>
      ))}
    </C>
  );
}

/**
 * Component for displaying a sleep period with start/end times and stage visualization
 *
 * @component
 * @param {Object} props - Component properties
 * @param {SleepDataPoint} props.dataPoint - Sleep data to display
 */
function SleepCard({ dataPoint }: { dataPoint: SleepDataPoint }) {
  const isSameDay = new Date(dataPoint.start).getDate() === new Date(dataPoint.end).getDate();

  const date = isSameDay
    ? uiFormatDateFull(dataPoint.start)
    : `${uiFormatDateWithMonth(dataPoint.start)} - ${uiFormatDateFull(dataPoint.end)}`;

  const start = uiFormatTime(dataPoint.start);
  const end = uiFormatTime(dataPoint.end);

  return (
    <C className="mx-auto my-2 w-full max-w-content overflow-hidden rounded-sm bg-white">
      <C className="p-4">
        <C className="mb-2 flex-row items-center justify-between">
          <C className="flex-row items-center gap-2">
            <B.Icon name="Moon" size={4} className="text-c-base" />
            <T.Body>{start}</T.Body>
          </C>
          <T.Body>{date}</T.Body>
          <C className="flex-row items-center gap-2">
            <B.Icon name="Sun" size={4} className="text-c-base" />
            <T.Body>{end}</T.Body>
          </C>
        </C>
        <SleepStagesGraph stages={dataPoint.stages} />
        <C className={'mt-2'}>
          <T.CardSupport>
            <T__>{dataPoint.source ?? 'Unbekannt'}</T__>
          </T.CardSupport>
        </C>
      </C>
    </C>
  );
}

/**
 * Component for visualizing sleep stages as a timeline graph
 * Shows different sleep stages color-coded and proportionally sized
 *
 * @component
 * @param {Object} props - Component properties
 * @param {SleepStage[]} props.stages - Array of sleep stages to visualize
 */
function SleepStagesGraph({ stages }: { stages: SleepStage[] }) {
  const sleepStart = new Date(stages[0]!.start).getTime();
  const sleepEnd = new Date(stages[stages.length - 1]!.end).getTime();
  const totalDuration = (sleepEnd - sleepStart) / (1000 * 60);

  const significantStages = stages.filter((stage) => {
    if (stage.type === 'unspecified') {
      return !stages.some(
        (otherStage) =>
          otherStage.type !== 'unspecified' &&
          new Date(otherStage.start).getTime() <= new Date(stage.start).getTime() &&
          new Date(otherStage.end).getTime() >= new Date(stage.end).getTime(),
      );
    }
    return true;
  });

  /**
   * Calculates styling for a sleep stage segment
   * @param {SleepStage} stage - Sleep stage to position
   * @returns {Object} CSS styles for the stage segment
   */
  const getStageStyle = (stage: SleepStage) => {
    const stageStart = new Date(stage.start).getTime();
    const stageEnd = new Date(stage.end).getTime();
    const startPercentage = ((stageStart - sleepStart) / (1000 * 60) / totalDuration) * 100;
    const width = ((stageEnd - stageStart) / (1000 * 60) / totalDuration) * 100;

    return {
      left: `${startPercentage}%`,
      width: `${width}%`,
      backgroundColor: SLEEP_STAGE_COLORS[stage.type],
    };
  };

  return (
    <C className="relative h-4 w-full overflow-hidden rounded bg-plain">
      {significantStages.map((stage, index) => (
        <C key={index} style={getStageStyle(stage)} className="absolute h-full" />
      ))}
    </C>
  );
}
