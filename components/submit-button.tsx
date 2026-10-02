"use client";

import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";

/**
 * A form's submit button that shows it is working. Elderly users who see
 * no response tap again; this disables the button and swaps in a spinner
 * until the server action finishes. Works inside server-rendered forms.
 */
export function SubmitButton({
  children,
  className,
  pendingLabel,
}: {
  children: React.ReactNode;
  className: string;
  /** Read by screen readers while pending; visually the spinner shows. */
  pendingLabel: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={`${className} disabled:opacity-70`}>
      {pending ? (
        <>
          <Loader2 aria-hidden="true" className="size-6 animate-spin" />
          <span className="sr-only">{pendingLabel}</span>
        </>
      ) : (
        children
      )}
    </button>
  );
}
