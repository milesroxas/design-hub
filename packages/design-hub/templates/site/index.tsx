import { SiteShell } from '@kit/SiteShell';
import { Button, notInPrototype } from '@kit/ui';
import './styles.css';

export default function Prototype() {
  return (
    <SiteShell>
      <section className="page-hero">
        <h1>{{title}}</h1>
        <p className="page-lede">Replace with the question from README.md.</p>
        <Button kind="primary" label="Get started" onClick={() => notInPrototype('The call to action')} />
      </section>
      <section className="page-section">
        <h2>The section under test</h2>
        <p>
          Build the page here with @kit/ui, section by section, each reading its content from fixtures.json
          the way the CMS will hand it over.
        </p>
      </section>
    </SiteShell>
  );
}
