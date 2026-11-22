"use client";

import { Button } from "@/components/ui/primitives";

/** Opens the browser's print dialog, which is also how a PDF is saved. */
export function PrintButton({ label = "Print or save as PDF" }: { label?: string }) {
  return (
    <Button type="button" className="print:hidden" onClick={() => window.print()}>
      {label}
    </Button>
  );
}
