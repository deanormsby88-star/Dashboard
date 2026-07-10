export default function JsonViewer({ label, value }: { label: string; value: unknown }) {
  return (
    <details className="group">
      <summary className="cursor-pointer text-xs font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200">
        {label}
      </summary>
      <pre className="mt-2 max-h-96 overflow-auto rounded-lg bg-slate-100 p-3 text-xs leading-relaxed text-slate-700 dark:bg-slate-950 dark:text-slate-300">
        {JSON.stringify(value, null, 2)}
      </pre>
    </details>
  );
}
