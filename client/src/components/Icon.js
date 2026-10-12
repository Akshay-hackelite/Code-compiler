import React from "react";
const paths = {
  code: "m8 7-5 5 5 5m8-10 5 5-5 5m-3-14-2 18",
  play: "m8 5 11 7-11 7Z",
  grid: "M3 3h7v7H3zM14 3h7v7h-7zM3 14h7v7H3zM14 14h7v7h-7z",
  file: "M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Zm0 0v6h6",
  history: "M3 11a9 9 0 1 1 2.7 7M3 4v7h7m2-5v6l4 2",
  settings: "M4 7h16M4 17h16M8 4v6M16 14v6",
  check: "m5 12 4 4L19 6",
  terminal: "m4 5 6 6-6 6m9 0h7",
  arrow: "m8 4 8 8-8 8",
  upload: "M12 16V3m-5 5 5-5 5 5M4 16v5h16v-5",
  download: "M12 3v13m-5-5 5 5 5-5M4 16v5h16v-5",
  share:
    "M15 8a3 3 0 1 0 0-4 3 3 0 0 0 0 4Zm0 12a3 3 0 1 0 0-4 3 3 0 0 0 0 4ZM3 14a3 3 0 1 0 0-4 3 3 0 0 0 0 4Zm5-3 7-4m-7 6 7 4",
  plus: "M12 5v14M5 12h14",
  x: "m6 6 12 12M6 18 18 6",
  copy: "M9 9h12v12H9zM5 15H3V3h12v2",
  sun: "M12 3V1m0 22v-2M3 12H1m22 0h-2M5 5 3 3m18 18-2-2M5 19l-2 2M21 3l-2 2M16 12a4 4 0 1 1-8 0 4 4 0 0 1 8 0",
  moon: "M21 13a9 9 0 1 1-10-10 7 7 0 0 0 10 10",
  queue: "M8 5h13M8 12h13M8 19h13M3 5h.01M3 12h.01M3 19h.01",
  book: "M3 3h6l3 2 3-2h6v17h-6l-3 2-3-2H3Zm9 2v17",
  stop: "M6 6h12v12H6z",
  reset: "M3 10a9 9 0 1 1 1 8M3 3v7h7",
  bolt: "m13 2-9 12h7l-1 8 10-12h-7Z",
  expand: "M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5",
};
export default function Icon({ name, size = 18, ...props }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.65"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...props}
    >
      <path d={paths[name] || paths.code} />
    </svg>
  );
}
