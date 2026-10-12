import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import App from "./App";
jest.mock(
  "./components/CodeEditor",
  () =>
    function MockEditor({ value, onChange }) {
      return (
        <textarea
          aria-label="Source code editor"
          value={value}
          onChange={(event) => onChange(event.target.value)}
        />
      );
    },
);
beforeEach(() => {
  localStorage.clear();
  if (!global.AbortSignal.timeout)
    global.AbortSignal.timeout = () => new AbortController().signal;
  global.fetch = jest.fn(async (url) => ({
    ok: true,
    json: async () =>
      url.endsWith("/health")
        ? { status: "ok", queue: { mode: "memory", waiting: 0, active: 0 } }
        : url.endsWith("/run")
          ? { jobId: "job-123" }
          : {
              job: {
                _id: "job-123",
                status: "success",
                output: "Hello world!",
                durationMs: 12,
              },
            },
  }));
});
test("language switches preserve drafts and workspace autosaves", async () => {
  render(<App />);
  fireEvent.change(screen.getByLabelText("Source code editor"), {
    target: { value: "my C++ draft" },
  });
  fireEvent.change(screen.getByLabelText("Programming language"), {
    target: { value: "py" },
  });
  fireEvent.change(screen.getByLabelText("Source code editor"), {
    target: { value: "print(42)" },
  });
  fireEvent.change(screen.getByLabelText("Programming language"), {
    target: { value: "cpp" },
  });
  expect(screen.getByLabelText("Source code editor")).toHaveValue(
    "my C++ draft",
  );
  await waitFor(() =>
    expect(
      JSON.parse(localStorage.getItem("compileit.workspace.v2")).drafts.py,
    ).toBe("print(42)"),
  );
});
test("run displays results and records a source snapshot", async () => {
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: /Run code/ }));
  await screen.findByText("Completed");
  expect(screen.getByText("Hello world!")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: /Run history/ }));
  expect(
    screen.getByRole("heading", { name: "Run history" }),
  ).toBeInTheDocument();
  expect(
    screen.getByRole("button", { name: "View result" }),
  ).toBeInTheDocument();
});
test("test cases are submitted and snippets can be saved and reopened", async () => {
  render(<App />);
  fireEvent.click(screen.getByRole("tab", { name: /Tests/ }));
  fireEvent.change(screen.getByLabelText("Expected output"), {
    target: { value: "42" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Run all tests" }));
  await waitFor(() =>
    expect(
      global.fetch.mock.calls.some(
        ([url, options]) =>
          url.endsWith("/run") &&
          JSON.parse(options.body).testCases[0].expected === "42",
      ),
    ).toBe(true),
  );
  await waitFor(() =>
    expect(screen.getByRole("button", { name: /Run code/ })).toBeEnabled(),
  );
  fireEvent.click(screen.getByRole("button", { name: "Save snippet" }));
  fireEvent.change(screen.getByLabelText("Snippet name"), {
    target: { value: "My example" },
  });
  fireEvent.submit(screen.getByLabelText("Snippet name").closest("form"));
  fireEvent.click(screen.getByRole("button", { name: "My snippets" }));
  expect(screen.getByText("My example")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "Open" }));
  expect(screen.getByRole("dialog")).toBeInTheDocument();
});

test("regression capture uses the submitted input, not subsequently edited input", async () => {
  render(<App />);
  fireEvent.change(screen.getByLabelText("Standard input"), {
    target: { value: "original input" },
  });
  fireEvent.click(screen.getByRole("button", { name: /Run code/ }));
  await screen.findByText("Completed");
  fireEvent.change(screen.getByLabelText("Standard input"), {
    target: { value: "new input" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Keep as a test case" }));
  const expected = screen.getAllByLabelText("Expected output");
  expect(expected).toHaveLength(2);
  expect(expected[1]).toHaveValue("Hello world!");
  expect(screen.getAllByLabelText("Input")[1]).toHaveValue("original input");
});

test("simplified navigation exposes queue explanation without a dashboard", async () => {
  render(<App />);
  expect(
    screen.queryByRole("button", { name: "Templates" }),
  ).not.toBeInTheDocument();
  expect(screen.queryByText("Your ideas. No limits.")).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "How execution works" }));
  expect(screen.getByRole("dialog")).toHaveTextContent(
    "program joins a waiting line",
  );
  expect(screen.getByRole("dialog")).toHaveTextContent(
    "This browser’s local storage",
  );
  await screen.findByText("Memory (resets on restart)");
});

test("a lost submission response is retried with the same idempotency key", async () => {
  const original = global.fetch;
  let firstKey;
  let attempts = 0;
  global.fetch = jest.fn(async (url, options) => {
    if (url.endsWith("/run")) {
      attempts++;
      if (attempts === 1) {
        firstKey = options.headers["Idempotency-Key"];
        throw new TypeError("Network response lost");
      }
      expect(options.headers["Idempotency-Key"]).toBe(firstKey);
    }
    return original(url, options);
  });
  render(<App />);
  fireEvent.click(screen.getByRole("button", { name: /Run code/ }));
  await screen.findByText("Completed", {}, { timeout: 2500 });
  expect(attempts).toBe(2);
});
