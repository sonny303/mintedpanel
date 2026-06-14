import React from 'react';
import { Sidebar } from './Sidebar';
import { TopBar } from './TopBar';

interface AppShellProps {
  children: React.ReactNode;
  topBarContent?: React.ReactNode;
}

export function AppShell({ children, topBarContent }: AppShellProps) {
  return (
    <div className="flex h-dvh w-full bg-background overflow-hidden font-sans text-foreground">
      <Sidebar />
      <div className="flex-1 flex flex-col h-full overflow-hidden">
        <TopBar>{topBarContent}</TopBar>
        <main className="flex-1 overflow-y-auto p-4">{children}</main>
      </div>
    </div>
  );
}
