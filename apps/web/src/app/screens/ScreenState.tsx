import type { ReactNode } from 'react';
import { Button, Card, Mascot } from '../../design-system';
import { Screen } from '../layout';

/** What a screen shows while its first read is in flight. */
export function Loading({ label }: { label: string }) {
  return (
    <Screen>
      <Card tone="sunken" padding={24} style={{ textAlign: 'center' }}>
        <p role="status" style={{ margin: 0, font: 'var(--type-body)', color: 'var(--fg-2)' }}>
          {label}
        </p>
      </Card>
    </Screen>
  );
}

/** What a screen shows when a read failed. Nothing is lost, and retry is offered. */
export function Failed({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Screen>
      <Card tone="sunken" padding={24} style={{ textAlign: 'center' }}>
        <Mascot expression="thinking" size={56} color="var(--fg-3)" style={{ margin: '0 auto 10px' }} />
        <p style={{ margin: '0 0 14px', font: 'var(--type-body)', color: 'var(--fg-2)' }}>{message}</p>
        <Button variant="secondary" icon="rotate-ccw" onClick={onRetry}>
          Try again
        </Button>
      </Card>
    </Screen>
  );
}

/** One line of explanation, and one action. */
export function Empty({
  message,
  children,
  thinking = true,
}: {
  message: string;
  children?: ReactNode;
  thinking?: boolean;
}) {
  return (
    <Card tone="sunken" padding={24} style={{ textAlign: 'center' }}>
      {thinking && (
        <Mascot expression="thinking" size={56} color="var(--fg-3)" style={{ margin: '0 auto 10px' }} />
      )}
      <p style={{ margin: 0, font: 'var(--type-body)', color: 'var(--fg-2)' }}>{message}</p>
      {children && <div style={{ marginTop: 14, display: 'grid', justifyContent: 'center' }}>{children}</div>}
    </Card>
  );
}
