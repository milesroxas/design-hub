import { Artboard, Board, type FormatName } from '@kit/Artboard';
import { useDials } from '@kit/dials';
import { type FixtureSets, fixtureSets, SET_NAMES, type SetName } from '@kit/fixtures';
import { Icon } from '@kit/Icon';
import { BRAND } from '@kit/shell';
import data from './fixtures.json';
import './styles.css';

type Post = { id: string; kicker: string; headline: string; sub: string; cta: string; image: string | null };

const sets: FixtureSets<Post> = fixtureSets(data satisfies { real: Post[]; missing: Post[] }, {
  max: 3,
  text: ['headline', 'sub'],
});

const ARTBOARDS: { format: FormatName; name: string }[] = [
  { format: 'post-square', name: 'square' },
  { format: 'post-portrait', name: 'portrait' },
  { format: 'story', name: 'story' },
];

function PostArt({ post, layout, tone }: { post: Post | undefined; layout: string; tone: string }) {
  if (!post)
    return (
      <div className="post-art post-none" data-tone={tone}>
        <p>No post in this set.</p>
      </div>
    );
  const photo = layout === 'photo';
  return (
    <div className="post-art" data-tone={tone} data-layout={layout}>
      {photo ? (
        <div
          className={post.image ? 'post-photo' : 'post-photo is-missing'}
          style={post.image ? { background: post.image } : undefined}
          aria-hidden="true"
        />
      ) : null}
      <div className="post-copy">
        {post.kicker ? <p className="post-kicker">{post.kicker}</p> : null}
        <h2 className="post-headline">{post.headline}</h2>
        {post.sub ? <p className="post-sub">{post.sub}</p> : null}
        {post.cta ? <p className="post-cta">{post.cta}</p> : null}
      </div>
      <p className="post-brand">
        <Icon name={BRAND.glyph} size={40} />
        {BRAND.name}
      </p>
    </div>
  );
}

// The post is its own component so its Review panel registers before the Board's.
function Posts() {
  const review = useDials(
    'Review',
    {
      fixtures: { type: 'select', options: [...SET_NAMES], default: 'real' },
      post: { type: 'select', options: ['1', '2', '3'], default: '1' },
      layout: { type: 'select', options: ['photo', 'type'], default: 'photo' },
      tone: { type: 'select', options: ['brand', 'light'], default: 'brand' },
    },
    {
      hints: {
        fixtures:
          'Which fixture set the post reads. longest, empty and max are derived from real by @kit/fixtures.',
        post: 'Which post in the set. A set with fewer posts shows its last.',
        layout: 'photo: an image above the copy. type: copy alone, larger.',
        tone: 'brand: the brand colour behind white type. light: the page colour behind brand type.',
      },
    },
  );
  const posts = sets[review.fixtures as SetName];
  const post = posts[Math.min(Number(review.post), posts.length) - 1];
  return (
    <>
      {ARTBOARDS.map((a) => (
        <Artboard key={a.name} format={a.format} name={a.name}>
          <PostArt post={post} layout={review.layout as string} tone={review.tone as string} />
        </Artboard>
      ))}
    </>
  );
}

export default function Prototype() {
  return (
    <Board
      title="Sample social post"
      lede="Does one template hold every post the team will write, in every format?"
    >
      <Posts />
    </Board>
  );
}
