export function ImportIcon() {
  return (
    <svg
      className="w-[17px] h-[17px] block fill-none stroke-current stroke-2 [stroke-linecap:round] [stroke-linejoin:round]"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path d="M12 3v10" />
      <path d="m8 9 4 4 4-4" />
      <path d="M5 15v4h14v-4" />
    </svg>
  );
}

export function FlipIcon() {
  return (
    <svg
      className="w-[17px] h-[17px] block fill-none stroke-current stroke-2 [stroke-linecap:round] [stroke-linejoin:round]"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path d="M7 7h8.5a4.5 4.5 0 0 1 4.5 4.5v0A4.5 4.5 0 0 1 15.5 16H9" />
      <path d="M7 7l3-3M7 7l3 3M17 17H8.5A4.5 4.5 0 0 1 4 12.5v0A4.5 4.5 0 0 1 8.5 8H15" />
      <path d="M17 17l-3-3M17 17l-3 3" />
    </svg>
  );
}

export function ArrowIcon({ off }: { off: boolean }) {
  return (
    <svg
      className="w-[17px] h-[17px] block fill-none stroke-current stroke-2 [stroke-linecap:round] [stroke-linejoin:round]"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path d="M5 19 18 6" />
      <path d="M10 6h8v8" />
      {off ? <path d="M4 4l16 16" /> : null}
    </svg>
  );
}

export function RefreshIcon() {
  return (
    <svg
      className="w-[17px] h-[17px] block fill-none stroke-current stroke-2 [stroke-linecap:round] [stroke-linejoin:round]"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path d="M20 11a8 8 0 0 0-14.5-4.6L4 8" />
      <path d="M4 4v4h4" />
      <path d="M4 13a8 8 0 0 0 14.5 4.6L20 16" />
      <path d="M20 20v-4h-4" />
    </svg>
  );
}

export function ResetIcon() {
  return (
    <svg
      className="w-[17px] h-[17px] block fill-none stroke-current stroke-2 [stroke-linecap:round] [stroke-linejoin:round]"
      viewBox="0 0 24 24"
      aria-hidden="true"
    >
      <path d="M6 6l12 12" />
      <path d="M18 6l-12 12" />
    </svg>
  );
}
