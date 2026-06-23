'use client';

interface Props {
  name: string;
  value?: string;
  label: string;
  options: string[];
}

export function FilterSelect({ name, value, label, options }: Props) {
  return (
    <form method="get" className="flex items-center gap-2">
      <label className="text-xs" style={{ color: 'var(--text-muted)' }}>{label}:</label>
      <select
        name={name}
        defaultValue={value ?? ''}
        className="input"
        style={{ width: 'auto', padding: '5px 10px', fontSize: 12 }}
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        onChange={(e: any) => e.target.form.submit()}
      >
        <option value="">All</option>
        {options.map(o => <option key={o} value={o}>{o}</option>)}
      </select>
    </form>
  );
}
