import { DialVars } from '@kit/dials';
import { Space } from '@kit/Space';
import { Variants } from '@kit/Variants';
import './styles.css';

function Baseline() {
  return (
    <div className="specimen" data-direction="baseline">
      <button type="button" className="specimen-button">
        Continue
      </button>
    </div>
  );
}

function Lift() {
  return (
    <div className="specimen" data-direction="lift">
      <button type="button" className="specimen-button">
        Continue
      </button>
    </div>
  );
}

function Sink() {
  return (
    <div className="specimen" data-direction="sink">
      <button type="button" className="specimen-button">
        Continue
      </button>
    </div>
  );
}

export default function Prototype() {
  return (
    <Space title="{{title}}" lede="Replace with the question from README.md.">
      <Variants options={{ Baseline, Lift, Sink }} />
      <DialVars name="{{title}}" config={{ press: [0.97, 0.9, 1, 0.005], duration: [160, 0, 600, 10] }} />
    </Space>
  );
}
