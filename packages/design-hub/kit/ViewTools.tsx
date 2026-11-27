import { useDialKitController } from 'dialkit';
import { createContext, useContext, useEffect, useLayoutEffect, useState } from 'react';
import { ensureDialRoot } from './dials';
import {
  type Appearance,
  prefersReducedMotion,
  setAppearance,
  setForceReduce,
  setSpeed,
  useAppearance,
} from './prefs';

const SPEEDS: Record<string, number> = { '1×': 1, '0.5×': 0.5, '0.25×': 0.25, '0.1×': 0.1 };

/**
 * What the View panel can hold. `theme` is system, light and dark. `motion`
 * is Reduce motion and Speed together: both are about things that move.
 */
export type ViewTool = 'theme' | 'motion';
const ALL: readonly ViewTool[] = ['theme', 'motion'];

/**
 * The tools that make sense where a prototype stands, set by what it stands
 * on. A `Board` allows none: collateral is a still file with one look, so it
 * has no motion to slow and no theme to flip. Null allows all of them.
 */
export const ViewScope = createContext<readonly ViewTool[] | null>(null);

/** The tools asked for that the surroundings allow. */
function useAllowed(tools: readonly ViewTool[] | undefined) {
  const scope = useContext(ViewScope);
  return (tools ?? ALL).filter((t) => !scope || scope.includes(t));
}

// The View dials a prototype gets, in the Space and the shells alike: only the
// ones that change something there. With none, there is no View panel.
// Theme mirrors @kit/prefs both ways, so a product setting or ?theme= moves the dial too.
export function ViewTools({ tools }: { tools?: readonly ViewTool[] }) {
  const allowed = useAllowed(tools);
  if (allowed.length === 0) return null;
  return (
    <ViewPanel key={allowed.join()} theme={allowed.includes('theme')} motion={allowed.includes('motion')} />
  );
}

function ViewPanel({ theme, motion }: { theme: boolean; motion: boolean }) {
  const appearance = useAppearance();
  const [config] = useState(() => ({
    ...(theme
      ? { theme: { type: 'select' as const, options: ['system', 'light', 'dark'], default: appearance } }
      : {}),
    ...(motion
      ? {
          reduceMotion: prefersReducedMotion(),
          speed: { type: 'select' as const, options: Object.keys(SPEEDS), default: '1×' },
        }
      : {}),
  }));
  useLayoutEffect(ensureDialRoot, []);
  const { values, setValue } = useDialKitController('View', config, {
    id: 'view',
    defaultCollapsed: true,
  });
  const v = values as { theme?: string; reduceMotion?: boolean; speed?: string };
  useTheme(theme, v.theme, appearance, setValue as (path: string, value: string) => void);
  useMotion(motion, v.reduceMotion, v.speed);
  return null;
}

function useTheme(
  on: boolean,
  value: string | undefined,
  appearance: Appearance,
  setValue: (path: string, value: string) => void,
) {
  useEffect(() => {
    if (on && value) setAppearance(value as Appearance);
  }, [on, value]);
  useEffect(() => {
    if (on) setValue('theme', appearance);
  }, [on, appearance, setValue]);
}

function useMotion(on: boolean, reduce: boolean | undefined, speed: string | undefined) {
  useEffect(() => {
    if (on) setForceReduce(reduce === true);
  }, [on, reduce]);
  useEffect(() => {
    if (on) setSpeed(SPEEDS[speed ?? ''] ?? 1);
  }, [on, speed]);
  // Leaving a page that had the motion tools puts motion back as the person's own settings have it.
  useEffect(
    () => () => {
      if (!on) return;
      setForceReduce(false);
      setSpeed(1);
    },
    [on],
  );
}
