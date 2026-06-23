'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

/** Refreshes the dashboard page every 5 seconds to show live-updating run list */
export function DashboardRefresher() {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), 5000);
    return () => clearInterval(id);
  }, [router]);

  return null;
}
