/** Shows ?error= / ?ok= messages that server actions redirect back with. */
export function Flash({ error, ok }: { error?: string; ok?: string }) {
  if (error) return <div className="warn error-box" role="alert">{error.slice(0, 300)}</div>;
  if (ok) return <div className="okbox" role="status">{ok.slice(0, 300)}</div>;
  return null;
}
