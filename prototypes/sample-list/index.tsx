import { AppShell, PageHead } from '@kit/AppShell';
import { DialVars, useDials } from '@kit/dials';
import { type FixtureSets, fixtureSets, SET_NAMES, type SetName } from '@kit/fixtures';
import { fmtDate, plural } from '@kit/format';
import { useHashRoute } from '@kit/hooks';
import { Badge, Button, notInPrototype, toast } from '@kit/ui';
import type { CSSProperties } from 'react';
import data from './fixtures.json';
import './styles.css';

type Item = {
  id: string;
  name: string;
  owner: string;
  status: string;
  updated: string;
  cover: string | null;
};

const MAX_ROWS = 40;
const sets: FixtureSets<Item> = fixtureSets(data satisfies { real: Item[]; missing: Item[] }, {
  max: MAX_ROWS,
  text: ['name', 'owner'],
});

const TONE: Record<string, 'success' | 'warning' | 'brand'> = {
  active: 'brand',
  paused: 'warning',
  done: 'success',
};

// The list is its own component so its Review panel registers before the
// Motion dials and View: a child registers before its parent, and siblings in order.
function ItemsPage() {
  const review = useDials(
    'Review',
    {
      fixtures: { type: 'select', options: [...SET_NAMES], default: 'real' },
      density: { type: 'select', options: ['comfortable', 'compact'], default: 'comfortable' },
    },
    {
      hints: {
        fixtures:
          'Which fixture set the list shows. longest, empty and max are derived from real by @kit/fixtures.',
        density: 'Row height: 56px comfortable, 44px compact.',
      },
    },
  );
  const items = sets[review.fixtures as SetName];

  return (
    <div className="page" data-density={review.density}>
      <PageHead
        title="Items"
        actions={<Button kind="primary" label="New item" onClick={() => notInPrototype('Adding an item')} />}
      />
      {items.length === 0 ? (
        <div className="card empty">
          <h3>No items yet</h3>
          <p>New item starts the first one.</p>
        </div>
      ) : (
        <div className="card table-card">
          <ul className="items">
            {items.map((item, i) => (
              <li key={item.id} className="item-row" style={{ '--i': Math.min(i, 8) } as CSSProperties}>
                <a
                  className="item-link"
                  href={`#/items/${item.id}`}
                  onClick={(e) => {
                    e.preventDefault();
                    toast(`${item.name || 'The item'} would open here.`, { kind: 'scope' });
                  }}
                >
                  {item.cover ? (
                    <span className="item-cover" style={{ background: item.cover }} aria-hidden="true" />
                  ) : (
                    <span className="item-cover is-missing" aria-hidden="true" />
                  )}
                  <span className="item-text">
                    <span className="item-name">
                      {item.name || <span className="item-unnamed">Untitled</span>}
                    </span>
                    <span className="item-owner">{item.owner || 'No owner'}</span>
                  </span>
                </a>
                <Badge tone={TONE[item.status]} dot>
                  {item.status}
                </Badge>
                <time className="item-date tabular" dateTime={item.updated}>
                  {fmtDate(item.updated) || 'Never'}
                </time>
              </li>
            ))}
          </ul>
          <div className="table-foot">
            <span className="foot-sum">{plural(items.length, 'item')}</span>
          </div>
        </div>
      )}
    </div>
  );
}

export default function Prototype() {
  const { path } = useHashRoute('#/items');
  return (
    <AppShell active={path}>
      <ItemsPage />
      <DialVars
        name="Motion"
        config={{ rise: [220, 0, 600, 10], stagger: [30, 0, 120, 5] }}
        options={{
          hints: {
            rise: 'How long each row takes to arrive, in ms.',
            stagger: 'The gap between one row and the next, in ms.',
          },
        }}
      />
    </AppShell>
  );
}
