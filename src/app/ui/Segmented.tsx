/** iOS-style segmented control built on radio inputs (works without JavaScript). */
export function Segmented({ name, value, options }: { name: string; value: string; options: { value: string; label: string }[] }) {
  return (
    <div className="seg" role="radiogroup">
      {options.map((o) => (
        <label key={o.value}>
          <input type="radio" name={name} value={o.value} defaultChecked={value === o.value} />
          <span>{o.label}</span>
        </label>
      ))}
    </div>
  );
}
