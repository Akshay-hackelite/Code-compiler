import React, { useState } from "react";
export function compareOutput(expected, actual) {
  const normalize = (text) => text.replace(/\r\n/g, "\n").trimEnd();
  const left = normalize(expected).split("\n"),
    right = normalize(actual).split("\n");
  const length = Math.max(left.length, right.length);
  let firstMismatch = null;
  const rows = Array.from({ length }, (_, index) => {
    const expected = left[index],
      actual = right[index];
    const changed = expected !== actual;
    if (changed && !firstMismatch) {
      let column = 0;
      while (
        column < Math.min(expected?.length || 0, actual?.length || 0) &&
        expected[column] === actual[column]
      )
        column++;
      firstMismatch = { line: index + 1, column: column + 1 };
    }
    return { line: index + 1, expected, actual, changed };
  });
  return { rows, firstMismatch };
}
export default function OutputDiff({ result }) {
  const [showWhitespace, setShowWhitespace] = useState(false);
  const { rows, firstMismatch } = compareOutput(
    result.expected || "",
    result.stdout || "",
  );
  const firstRow = Math.max(0, (firstMismatch?.line || 1) - 4);
  const display = (text) =>
    text === undefined
      ? "(missing line)"
      : text === ""
        ? "(empty)"
        : showWhitespace
          ? text.replace(/ /g, "·").replace(/\t/g, "→   ")
          : text;
  return (
    <div className="output-diff">
      {result.passed ? (
        <p className="test-match">Output matches · {result.durationMs} ms</p>
      ) : (
        <>
          <div className="diff-heading">
            <span>
              {firstMismatch
                ? `First difference: line ${firstMismatch.line}, column ${firstMismatch.column}`
                : `Execution ${result.status === "timeout" ? "timed out" : result.status === "output_limit" ? "exceeded output limit" : "failed"}`}
            </span>
            <label>
              <input
                type="checkbox"
                checked={showWhitespace}
                onChange={(e) => setShowWhitespace(e.target.checked)}
              />{" "}
              Show spaces
            </label>
          </div>
          <div
            className="diff-table"
            role="table"
            aria-label="Expected and actual output comparison"
          >
            <div className="diff-row diff-labels" role="row">
              <span role="columnheader">Line</span>
              <span role="columnheader">Expected</span>
              <span role="columnheader">Actual</span>
            </div>
            {rows.slice(firstRow, firstRow + 100).map((row) => (
              <div
                className={`diff-row ${row.changed ? "different" : ""}`}
                role="row"
                key={row.line}
              >
                <span role="cell">{row.line}</span>
                <code role="cell">{display(row.expected)}</code>
                <code role="cell">{display(row.actual)}</code>
              </div>
            ))}
          </div>
          {rows.length > 100 && (
            <p className="muted">
              Showing lines {firstRow + 1}–
              {Math.min(rows.length, firstRow + 100)} around the first
              difference.
            </p>
          )}
        </>
      )}
      {result.stderr && <pre className="console-error">{result.stderr}</pre>}
    </div>
  );
}
