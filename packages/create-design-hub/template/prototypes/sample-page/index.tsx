import { DialVars, useDials } from '@kit/dials';
import { type FixtureSets, fixtureSets, SET_NAMES, type SetName } from '@kit/fixtures';
import { fmtDate, plural } from '@kit/format';
import { SiteShell } from '@kit/SiteShell';
import { Button, notInPrototype, toast } from '@kit/ui';
import type { CSSProperties } from 'react';
import data from './fixtures.json';
import './styles.css';

type Post = {
  id: string;
  title: string;
  excerpt: string;
  category: string;
  published: string;
  image: string | null;
};

const MAX_POSTS = 40;
const sets: FixtureSets<Post> = fixtureSets(data satisfies { real: Post[]; missing: Post[] }, {
  max: MAX_POSTS,
  text: ['title', 'excerpt'],
});

function PostCard({ post, index }: { post: Post; index: number }) {
  return (
    <li className="post" style={{ '--i': Math.min(index, 8) } as CSSProperties}>
      <a
        className="post-link"
        href={`#/journal/${post.id}`}
        onClick={(e) => {
          e.preventDefault();
          toast(`${post.title || 'The post'} would open here.`, { kind: 'scope' });
        }}
      >
        {post.image ? (
          <span className="post-image" style={{ background: post.image }} aria-hidden="true" />
        ) : (
          <span className="post-image is-missing" aria-hidden="true" />
        )}
        <span className="post-meta">
          {post.category ? <span className="post-category">{post.category}</span> : null}
          <time className="tabular" dateTime={post.published}>
            {fmtDate(post.published) || 'Unscheduled'}
          </time>
        </span>
        <span className="post-title">{post.title || <span className="post-untitled">Untitled</span>}</span>
        {post.excerpt ? <span className="post-excerpt">{post.excerpt}</span> : null}
      </a>
    </li>
  );
}

// The journal is its own component so its Review panel registers before the
// Motion dials and View: a child registers before its parent, and siblings in order.
function Journal() {
  const review = useDials(
    'Review',
    {
      fixtures: { type: 'select', options: [...SET_NAMES], default: 'real' },
      columns: { type: 'select', options: ['3', '2'], default: '3' },
    },
    {
      hints: {
        fixtures:
          'Which fixture set the grid shows. longest, empty and max are derived from real by @kit/fixtures.',
        columns: 'Cards per row on a wide screen. Phones always show one.',
      },
    },
  );
  const posts = sets[review.fixtures as SetName];

  return (
    <div className="journal" data-columns={review.columns}>
      <header className="journal-head">
        <h1>Journal</h1>
        <p className="journal-lede">Notes on the work: process, platforms and craft.</p>
      </header>
      {posts.length === 0 ? (
        <div className="journal-empty">
          <h2>No posts yet</h2>
          <p>The first post appears here when it is published.</p>
          <Button kind="secondary" label="Subscribe" onClick={() => notInPrototype('Subscribing')} />
        </div>
      ) : (
        <>
          <ul className="posts">
            {posts.map((post, i) => (
              <PostCard key={post.id} post={post} index={i} />
            ))}
          </ul>
          <p className="journal-foot tabular">{plural(posts.length, 'post')}</p>
        </>
      )}
    </div>
  );
}

export default function Prototype() {
  return (
    <SiteShell active="#/journal">
      <Journal />
      <DialVars
        name="Motion"
        config={{ rise: [260, 0, 600, 10], stagger: [40, 0, 120, 5] }}
        options={{
          hints: {
            rise: 'How long each card takes to arrive, in ms.',
            stagger: 'The gap between one card and the next, in ms.',
          },
        }}
      />
    </SiteShell>
  );
}
