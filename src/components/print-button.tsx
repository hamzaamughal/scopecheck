"use client";
export default function PrintButton() {
  return <button type="button" className="button primary" onClick={() => window.print()}>Save as PDF</button>;
}
