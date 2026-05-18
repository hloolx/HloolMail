

export function ConfigLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="config-line">
      <span>{label}</span>
      <code>{value}</code>
    </div>
  );
}
