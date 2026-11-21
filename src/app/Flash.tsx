import { IconAlert, IconCheckCircle } from "./ui/Icons";

/** Shows ?error= / ?ok= messages that server actions redirect back with. */
export function Flash({ error, ok }: { error?: string; ok?: string }) {
  if (error) return <div className="banner bad" role="alert"><IconAlert /><span className="grow">{error.slice(0, 300)}</span></div>;
  if (ok) return <div className="banner good" role="status"><IconCheckCircle /><span className="grow">{ok.slice(0, 300)}</span></div>;
  return null;
}
