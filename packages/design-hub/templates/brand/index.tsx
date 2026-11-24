import { Artboard, Board } from '@kit/Artboard';
import './styles.css';

export default function Prototype() {
  return (
    <Board title="{{title}}" lede="Replace with the question from README.md.">
      <Artboard format="post-square" name="square">
        <div className="piece">
          <p className="piece-kicker">Kicker</p>
          <h2 className="piece-headline">The headline, at the size it ships</h2>
          <p className="piece-sub">Every value here is in real pixels: this artboard is 1080 wide.</p>
        </div>
      </Artboard>
    </Board>
  );
}
