import type { ReactNode } from 'react';
import './space.css';
import { ViewTools } from './ViewTools';

type Props = {
  title: string;
  lede?: ReactNode;
  width?: 'narrow' | 'wide' | 'full';
  tools?: boolean;
  children: ReactNode;
};

// The low-gravity space: one thing on a quiet canvas, no product around it.
export function Space({ title, lede, width = 'wide', tools = true, children }: Props) {
  return (
    <main className="space" data-width={width}>
      <header className="space-head">
        <h1 className="space-title">{title}</h1>
        {lede ? <p className="space-lede">{lede}</p> : null}
      </header>
      {children}
      {tools ? <ViewTools /> : null}
    </main>
  );
}
