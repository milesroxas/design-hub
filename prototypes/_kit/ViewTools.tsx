import { useDialKitController } from 'dialkit';
import { useEffect, useLayoutEffect, useState } from 'react';
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

// The View dials every prototype gets, in the Space and the app shell alike.
// Theme mirrors @kit/prefs both ways, so a product setting or ?theme= moves the dial too.
export function ViewTools() {
  const appearance = useAppearance();
  const [config] = useState(() => ({
    theme: { type: 'select' as const, options: ['system', 'light', 'dark'], default: appearance },
    reduceMotion: prefersReducedMotion(),
    speed: { type: 'select' as const, options: Object.keys(SPEEDS), default: '1×' },
  }));
  useLayoutEffect(ensureDialRoot, []);
  const { values: v, setValue } = useDialKitController('View', config, {
    id: 'view',
    defaultCollapsed: true,
  });
  useEffect(() => setAppearance(v.theme as Appearance), [v.theme]);
  useEffect(() => setValue('theme', appearance), [appearance, setValue]);
  useEffect(() => setForceReduce(v.reduceMotion), [v.reduceMotion]);
  useEffect(() => setSpeed(SPEEDS[v.speed] ?? 1), [v.speed]);
  return null;
}
