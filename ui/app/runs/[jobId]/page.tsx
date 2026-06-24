import { fetchJob } from '../../../lib/api';
import { getAllEventsServer } from '../../../lib/api-server';
import { RunConsole } from './RunConsole';
import { notFound } from 'next/navigation';

export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ jobId: string }>;
}

export default async function RunPage({ params }: PageProps) {
  const { jobId } = await params;

  let job, events;
  try {
    [job, events] = await Promise.all([
      fetchJob(jobId),
      getAllEventsServer(jobId),
    ]);
  } catch {
    notFound();
  }

  return <RunConsole jobId={jobId} initialJob={job!} initialEvents={events ?? []} />;
}
