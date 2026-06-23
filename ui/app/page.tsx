import { fetchJobs, fetchMetrics } from '../lib/api';
import { MetricsStrip } from '../components/MetricsStrip';
import { RunTable } from '../components/RunTable';
import { StartJobModal } from '../components/StartJobModal';
import { DashboardRefresher } from '../components/DashboardRefresher';
import { FilterSelect } from '../components/FilterSelect';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ phase?: string; outcome?: string }>;
}) {
  const params = await searchParams;
  const [jobs, metrics] = await Promise.all([
    fetchJobs({ phase: params.phase, outcome: params.outcome }),
    fetchMetrics(),
  ]);

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-xl font-bold">Operations Dashboard</h1>
          <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
            All credential generation runs · auto-updating
          </p>
        </div>
        <StartJobModal />
      </div>

      <MetricsStrip metrics={metrics} />

      {/* Filter bar */}
      <div className="flex gap-3 mb-4">
        <FilterSelect name="phase" value={params.phase} label="Phase" options={['NAVIGATING','CAPTCHA','WAITING_FOR_OTP','DONE','FAILED','CANCELLED']} />
        <FilterSelect name="outcome" value={params.outcome} label="Outcome" options={['success','failure','cancelled']} />
      </div>

      <RunTable jobs={jobs} />

      {/* Client component that refreshes the page every 5s */}
      <DashboardRefresher />
    </div>
  );
}
