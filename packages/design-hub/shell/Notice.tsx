import { Component, type ReactNode } from 'react';
import './shell.css';

export function Notice({ title, body, detail }: { title: string; body: string; detail?: string }) {
  return (
    <main className="shell-notice sys">
      <h1>{title}</h1>
      <p>{body}</p>
      {detail ? <pre>{detail}</pre> : null}
      <a href="/">All prototypes</a>
    </main>
  );
}

export class Boundary extends Component<{ name: string; children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };

  static getDerivedStateFromError(error: Error) {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return <Notice title={`${this.props.name} crashed`} body={error.message} detail={error.stack} />;
  }
}
