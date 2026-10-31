import { AppShell, PageHead } from '@kit/AppShell';
import { useHashRoute } from '@kit/hooks';
import { Button, toast } from '@kit/ui';
import './styles.css';

export default function Prototype() {
  const { path } = useHashRoute('#/items');
  return (
    <AppShell active={path}>
      <div className="page">
        <PageHead
          title="{{title}}"
          desc="Replace with the question from README.md."
          actions={
            <Button
              kind="primary"
              label="Start"
              icon="plus"
              onClick={() => toast('Wire this to the flow under test.', { kind: 'scope' })}
            />
          }
        />
        <div className="card card-pad flow-body">
          <h2 className="card-title">The page under test</h2>
          <p className="card-sub">
            Build the flow here with @kit/ui. Sub-pages are hash routes, read with useHashRoute.
          </p>
        </div>
      </div>
    </AppShell>
  );
}
