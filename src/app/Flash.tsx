import { IconAlert } from "./ui/Icons";
import { Toast } from "./ui/Toast";

/** Errors stay inline (you need to read them); successes float as a toast. */
export function Flash({ error, ok }: { error?: string; ok?: string }) {
  if (error) return <div className="banner bad" role="alert"><IconAlert /><span className="grow">{error.slice(0, 300)}</span></div>;
  if (ok) return <Toast message={ok.slice(0, 200)} />;
  return null;
}
