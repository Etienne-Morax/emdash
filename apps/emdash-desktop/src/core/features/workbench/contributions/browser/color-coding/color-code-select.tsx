import { Select } from '@emdash/ui/react/primitives';
import {
  COLOR_CODE_KEYS,
  COLOR_CODE_LABELS,
  isColorCodeKey,
  type ColorCodeKey,
} from '@core/primitives/color-coding/api/color-coding';
import { useColorValue } from './use-color-coding';

const AUTOMATIC = 'auto';

function Swatch({ color }: { color: ColorCodeKey }) {
  const colorValue = useColorValue();
  return (
    <span
      aria-hidden
      className="inline-block size-2.5 shrink-0 rounded-full"
      style={{ backgroundColor: colorValue(color) }}
    />
  );
}

/**
 * Picks a colour-coding key. "Automatic" clears the explicit choice so the default
 * (palette rule or stable hash) applies; `resolved` is what Automatic currently gives.
 */
export function ColorCodeSelect({
  value,
  resolved,
  disabled,
  ariaLabel,
  onChange,
}: {
  value: string | undefined;
  resolved: ColorCodeKey;
  disabled?: boolean;
  ariaLabel: string;
  onChange: (next: ColorCodeKey | undefined) => void;
}) {
  const current = isColorCodeKey(value) ? value : AUTOMATIC;
  const shown = isColorCodeKey(value) ? value : resolved;
  return (
    <Select.Root
      value={current}
      disabled={disabled}
      onValueChange={(next) => onChange(isColorCodeKey(next) ? next : undefined)}
    >
      <Select.Trigger aria-label={ariaLabel} className="w-[183px] shrink-0 gap-2">
        <Select.Value>
          <span className="flex items-center gap-2">
            <Swatch color={shown} />
            {current === AUTOMATIC
              ? `Automatic (${COLOR_CODE_LABELS[resolved]})`
              : COLOR_CODE_LABELS[shown]}
          </span>
        </Select.Value>
      </Select.Trigger>
      <Select.Content align="end" className="min-w-max">
        <Select.Item value={AUTOMATIC}>
          <span className="flex items-center gap-2">
            <Swatch color={resolved} />
            Automatic ({COLOR_CODE_LABELS[resolved]})
          </span>
        </Select.Item>
        {COLOR_CODE_KEYS.map((key) => (
          <Select.Item key={key} value={key}>
            <span className="flex items-center gap-2">
              <Swatch color={key} />
              {COLOR_CODE_LABELS[key]}
            </span>
          </Select.Item>
        ))}
      </Select.Content>
    </Select.Root>
  );
}

/** Returns a copy of `colors` with `id` set to `next`, or removed when `next` is undefined. */
export function withColor(
  colors: Record<string, string>,
  id: string,
  next: ColorCodeKey | undefined
): Record<string, string> {
  const { [id]: _previous, ...rest } = colors;
  return next ? { ...rest, [id]: next } : rest;
}
