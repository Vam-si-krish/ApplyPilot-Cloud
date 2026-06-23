import AppShell from '@/components/AppShell';
import ProgressProvider from '@/components/ProgressContext';

export default function AuthedLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProgressProvider>
      <AppShell>{children}</AppShell>
    </ProgressProvider>
  );
}
