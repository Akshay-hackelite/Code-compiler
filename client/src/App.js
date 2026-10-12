import React, { useCallback, useEffect, useRef, useState } from "react";
import "./App.css";
import CodeEditor from "./components/CodeEditor";
import Icon from "./components/Icon";
import OutputDiff from "./components/OutputDiff";
import {
  LANGUAGES,
  initialWorkspace,
  readStorage,
  saveStorage,
  encodeShare,
  decodeShare,
  parseWorkspaceBackup,
  createWorkspaceBackup,
} from "./workspace";
const API = process.env.REACT_APP_API_URL || "http://localhost:5001";
const finished = ["success", "error", "timeout", "cancelled", "output_limit"];
async function request(path, options = {}) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  options.signal?.addEventListener("abort", abort, { once: true });
  if (options.signal?.aborted) controller.abort();
  const timeout = setTimeout(abort, 10000);
  try {
    const response = await fetch(`${API}${path}`, {
      ...options,
      signal: controller.signal,
      headers: { "Content-Type": "application/json", ...options.headers },
    });
    const data = await response.json();
    if (!response.ok)
      throw Object.assign(new Error(data.error || "Request failed."), {
        status: response.status,
      });
    return data;
  } finally {
    clearTimeout(timeout);
    options.signal?.removeEventListener("abort", abort);
  }
}
const statusLabel = (status) =>
  ({
    success: "Completed",
    error: "Failed",
    timeout: "Time limit exceeded",
    output_limit: "Output limit exceeded",
    cancelled: "Cancelled",
    pending: "In queue",
    running: "Running",
  })[status] || "Ready to run";
function App() {
  const [workspace, setWorkspace] = useState(initialWorkspace);
  const { language, drafts, input, tests } = workspace;
  const code = drafts[language];
  const lang = LANGUAGES[language];
  const [section, setSection] = useState("workspace");
  const [panel, setPanel] = useState("output");
  const [theme, setTheme] = useState(() =>
    readStorage("compileit.theme", "dark"),
  );
  const [fontSize, setFontSize] = useState(() =>
    readStorage("compileit.fontSize", 14),
  );
  const [history, setHistory] = useState(() =>
    readStorage("compileit.history", []),
  );
  const [snippets, setSnippets] = useState(() =>
    readStorage("compileit.snippets", []),
  );
  const [health, setHealth] = useState(null);
  const [job, setJob] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [saved, setSaved] = useState(true);
  const [saveFailed, setSaveFailed] = useState(false);
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const [focus, setFocus] = useState(false);
  const [modal, setModal] = useState(null);
  const [snippetName, setSnippetName] = useState("");
  const [imported, setImported] = useState(null);
  const backupUpload = useRef();
  const codeUpload = useRef();
  const inputUpload = useRef();
  const active = useRef(null);
  const mounted = useRef(true);
  const modalRef = useRef();
  const update = (patch) =>
    setWorkspace((previous) => ({ ...previous, ...patch }));
  const setCode = (value) =>
    setWorkspace((previous) => ({
      ...previous,
      drafts: { ...previous.drafts, [previous.language]: value },
    }));
  useEffect(() => {
    const timeout = setTimeout(() => {
      const ok = saveStorage("compileit.workspace.v2", workspace);
      setSaved(ok);
      setSaveFailed(!ok);
    }, 400);
    setSaved(false);
    return () => clearTimeout(timeout);
  }, [workspace]);
  useEffect(() => {
    saveStorage("compileit.theme", theme);
  }, [theme]);
  useEffect(() => {
    saveStorage("compileit.fontSize", fontSize);
  }, [fontSize]);
  useEffect(() => {
    if (!saveStorage("compileit.history", history))
      setNotice(
        "Run history could not be saved: browser storage is full or unavailable.",
      );
  }, [history]);
  useEffect(() => {
    saveStorage("compileit.snippets", snippets);
  }, [snippets]);
  useEffect(() => {
    if (notice) {
      const timer = setTimeout(() => setNotice(""), 4500);
      return () => clearTimeout(timer);
    }
  }, [notice]);
  useEffect(() => {
    let alive = true;
    let timeout;
    const ping = async () => {
      try {
        const data = await request("/health");
        if (alive) setHealth(data);
      } catch {
        if (alive) setHealth(null);
      }
      if (alive) timeout = setTimeout(ping, 5000);
    };
    ping();
    return () => {
      alive = false;
      clearTimeout(timeout);
    };
  }, []);
  useEffect(() => {
    mounted.current = true;
    if (window.location.hash.startsWith("#snippet=")) {
      try {
        setImported(decodeShare(window.location.hash.slice(9)));
        setModal("import");
      } catch (error) {
        setNotice(error.message);
      }
    }
    return () => {
      mounted.current = false;
      active.current?.controller.abort();
    };
  }, []);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement;
    modalRef.current?.querySelector("button, input")?.focus();
    const keys = (event) => {
      if (event.key === "Escape") setModal(null);
      if (event.key === "Tab") {
        const items = modalRef.current?.querySelectorAll(
          "button, input, select, a[href]",
        );
        if (!items?.length) return;
        if (event.shiftKey && document.activeElement === items[0]) {
          event.preventDefault();
          items[items.length - 1].focus();
        } else if (
          !event.shiftKey &&
          document.activeElement === items[items.length - 1]
        ) {
          event.preventDefault();
          items[0].focus();
        }
      }
    };
    document.addEventListener("keydown", keys);
    return () => {
      document.removeEventListener("keydown", keys);
      previous?.focus();
    };
  }, [modal]);
  const run = useCallback(
    async (withTests = false) => {
      if (active.current || !code.trim()) return;
      const controller = new AbortController();
      const execution = { controller, id: null };
      active.current = execution;
      setBusy(true);
      setPanel(withTests ? "tests" : "output");
      setJob({ status: "pending", submittedAt: new Date().toISOString() });
      const snapshot = { language, code, input, tests: withTests ? tests : [] };
      try {
        const submissionKey = `run-${window.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;
        const submit = () =>
          request("/run", {
            method: "POST",
            headers: { "Idempotency-Key": submissionKey },
            body: JSON.stringify({
              language,
              code,
              input,
              testCases: withTests ? tests : [],
            }),
          });
        let data;
        try {
          data = await submit();
        } catch (error) {
          if (controller.signal.aborted || (error.status && error.status < 500))
            throw error;
          await new Promise((resolve) => setTimeout(resolve, 500));
          if (controller.signal.aborted) throw error;
          data = await submit(); // A lost response can be retried without creating a second job.
        }
        execution.id = data.jobId;
        if (controller.signal.aborted) {
          await request(`/jobs/${data.jobId}`, { method: "DELETE" });
          return;
        }
        const deadline = Date.now() + 180000;
        while (!controller.signal.aborted) {
          if (Date.now() > deadline)
            throw new Error(
              "Stopped waiting after three minutes. Check the queue before submitting again.",
            );
          const { job: result } = await request(`/status?id=${data.jobId}`, {
            signal: controller.signal,
          });
          if (!mounted.current) return;
          setJob({ ...snapshot, ...result });
          if (finished.includes(result.status)) {
            setHistory((previous) =>
              [{ ...snapshot, ...result }, ...previous].slice(0, 30),
            );
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
      } catch (error) {
        if (mounted.current && !controller.signal.aborted)
          setJob({
            status: "error",
            output: `${error.message} Check that the API is running on ${API}.`,
          });
      } finally {
        if (active.current === execution) active.current = null;
        if (mounted.current) setBusy(false);
      }
    },
    [code, language, input, tests],
  );
  const cancel = async () => {
    const execution = active.current;
    if (!execution) return;
    try {
      if (execution.id)
        await request(`/jobs/${execution.id}`, { method: "DELETE" });
      execution.controller.abort();
      setJob((previous) => ({ ...previous, status: "cancelled" }));
    } catch (error) {
      setNotice(`Could not cancel: ${error.message}`);
    }
  };
  useEffect(() => {
    const handler = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
        event.preventDefault();
        run(event.shiftKey);
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        setModal("save");
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setModal("shortcuts");
      }
      if (event.key === "Escape") setFocus(false);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [run]);
  const copy = async (text) => {
    try {
      await navigator.clipboard.writeText(text);
      setNotice("Copied to clipboard.");
    } catch {
      setNotice(
        "Clipboard is unavailable. Select the text and copy it manually.",
      );
    }
  };
  const share = async () => {
    const url = `${window.location.origin}${window.location.pathname}#snippet=${encodeShare({ language, code, input })}`;
    if (url.length > 12000) {
      setNotice(
        "This snippet is too large for a share link. Download the source instead.",
      );
      return;
    }
    await copy(url);
  };
  const download = () => {
    const url = URL.createObjectURL(new Blob([code], { type: "text/plain" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = lang.file;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice(`${lang.file} downloaded.`);
  };
  const importFile = async (event, isInput) => {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 65536) {
      setNotice("Please choose a text file smaller than 64 KB.");
      return;
    }
    try {
      const text = await file.text();
      if (isInput) update({ input: text });
      else {
        const extension = file.name.split(".").pop();
        setImported({
          language:
            { cpp: "cpp", cc: "cpp", c: "c", py: "py", java: "java" }[
              extension
            ] || language,
          code: text,
          input,
        });
        setModal("import");
      }
    } catch {
      setNotice("Could not read this file.");
    }
  };
  const applySnippet = (item) => {
    setImported(item);
    setModal("import");
  };
  const queue = health?.queue;
  const resultsCurrent =
    job?.language === language &&
    job?.code === code &&
    JSON.stringify(job?.tests) === JSON.stringify(tests);
  const captureTest = () => {
    if (!job || job.status !== "success" || job.testResults?.length) return;
    if (tests.length >= 10) {
      setNotice("You can keep up to 10 test cases. Remove one first.");
      return;
    }
    const test = {
      input: job.input || "",
      expected: job.stdout ?? job.output ?? "",
    };
    if (new Blob([test.expected]).size > 65536) {
      setNotice("This output is too large for a test case (64 KB maximum).");
      return;
    }
    if (
      tests.some((t) => t.input === test.input && t.expected === test.expected)
    ) {
      setPanel("tests");
      setNotice("This test case is already saved.");
      return;
    }
    update({ tests: [...tests, test] });
    setPanel("tests");
    setNotice(
      "Run captured as a test. Future changes can be checked against it.",
    );
  };
  const exportBackup = () => {
    const text = createWorkspaceBackup(workspace, snippets);
    if (new Blob([text]).size > 8 * 1024 * 1024) {
      setNotice(
        "This workspace exceeds the 8 MB backup limit. Download large snippets separately.",
      );
      return;
    }
    const url = URL.createObjectURL(
      new Blob([text], { type: "application/json" }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = "compileit-workspace.json";
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setNotice("Workspace backup downloaded.");
  };
  const importBackup = async (event) => {
    const file = event.target.files[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      setNotice("Choose a workspace backup under 8 MB.");
      return;
    }
    try {
      setImported(parseWorkspaceBackup(await file.text()));
      setModal("restore");
    } catch (error) {
      setNotice(error.message);
    }
  };
  return (
    <div className={`app ${theme} ${focus ? "focus-mode" : ""}`}>
      <aside className="sidebar">
        <a
          className="brand"
          href="/"
          onClick={(event) => {
            event.preventDefault();
            setSection("workspace");
          }}
        >
          <span className="brand-mark">
            <Icon name="code" size={23} />
          </span>
          Compile<span className="brand-accent">It</span>
          <span className="brand-dot">.</span>
        </a>
        <div className="workspace-label">PERSONAL WORKSPACE</div>
        <nav aria-label="Main navigation">
          {[
            ["workspace", "code", "Playground"],
            ["snippets", "book", "My snippets"],
            ["history", "history", "Run history"],
          ].map(([id, icon, label]) => (
            <button
              className={`nav-item ${section === id ? "selected" : ""}`}
              onClick={() => setSection(id)}
              aria-label={label}
              key={id}
            >
              <Icon name={icon} />
              <span>{label}</span>
              {id === "history" && history.length > 0 && (
                <span className="nav-count">{history.length}</span>
              )}
              {id === "workspace" && <span className="nav-active-dot" />}
            </button>
          ))}
        </nav>
        <div className="sidebar-bottom">
          <button
            className="nav-item"
            aria-label="Settings and backups"
            onClick={() => setModal("settings")}
          >
            <Icon name="settings" />
            <span>Settings</span>
          </button>
          <button
            className="nav-item"
            aria-label="How execution works"
            onClick={() => setModal("system")}
          >
            <Icon name="queue" />
            <span>Execution info</span>
          </button>
          <span className="storage-note">Saved in this browser</span>
        </div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            Workspace <Icon name="arrow" size={12} />
            <span>
              {
                {
                  workspace: "Playground",
                  snippets: "My snippets",
                  history: "Run history",
                }[section]
              }
            </span>
          </div>
          <div className="topbar-actions">
            <button
              className="icon-button mobile-settings"
              aria-label="Settings and backups"
              onClick={() => setModal("settings")}
            >
              <Icon name="settings" />
            </button>
            <span className={`connection ${health ? "online" : ""}`}>
              <i />
              {health ? "API connected" : "API offline"}
            </span>
            <span className="topbar-divider" />
            <button
              className="icon-button"
              aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} theme`}
              onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            >
              <Icon name={theme === "dark" ? "sun" : "moon"} />
            </button>
            <button
              className="shortcut-help"
              onClick={() => setModal("shortcuts")}
            >
              ⌘ K <span>Shortcuts</span>
            </button>
          </div>
        </header>
        <main>
          {section === "workspace" ? (
            <>
              <div className="page-heading">
                <div>
                  <h1>Playground</h1>
                  <p>Write. Run. Refine.</p>
                </div>
                <button className="button secondary" onClick={share}>
                  <Icon name="share" size={16} /> Share snippet
                </button>
              </div>
              <div className="workspace-toolbar">
                <div className="language-select">
                  <span className="language-icon" style={{ color: lang.color }}>
                    {lang.badge}
                  </span>
                  <select
                    aria-label="Programming language"
                    value={language}
                    onChange={(e) => update({ language: e.target.value })}
                  >
                    {Object.entries(LANGUAGES).map(([id, item]) => (
                      <option value={id} key={id}>
                        {item.name}
                      </option>
                    ))}
                  </select>
                  <span className="version-label">{lang.version}</span>
                </div>
                <div className="toolbar-right">
                  <span className="autosave">
                    <span className={saved ? "saved-dot" : "saving-dot"} />
                    {saveFailed
                      ? "Storage full · export a backup"
                      : saved
                        ? "Draft saved"
                        : "Saving draft…"}
                  </span>
                  <button
                    className="button subtle"
                    onClick={() => setModal("save")}
                  >
                    <Icon name="plus" size={15} /> Save snippet
                  </button>
                  <span className="toolbar-separator" />
                  {busy ? (
                    <button className="button stop-button" onClick={cancel}>
                      <Icon name="stop" size={15} />
                      Stop run
                    </button>
                  ) : (
                    <button
                      className="button primary"
                      onClick={() => run()}
                      disabled={!code.trim()}
                    >
                      <Icon name="play" size={15} />
                      Run code <kbd>⌘ ↵</kbd>
                    </button>
                  )}
                </div>
              </div>
              <div className="ide-layout">
                <section className="editor-panel" aria-label="Code editor">
                  <div className="panel-header">
                    <div className="file-tab">
                      <Icon name="code" size={15} />
                      <span>{lang.file}</span>
                      <i />
                    </div>
                    <div className="panel-tools">
                      <button
                        className="icon-button"
                        title="Import source file"
                        aria-label="Import source file"
                        onClick={() => codeUpload.current.click()}
                      >
                        <Icon name="upload" size={15} />
                      </button>
                      <button
                        className="icon-button"
                        title="Download source"
                        aria-label="Download source"
                        onClick={download}
                      >
                        <Icon name="download" size={15} />
                      </button>
                      <button
                        className="icon-button"
                        title="Focus editor"
                        aria-label="Toggle focus editor"
                        onClick={() => setFocus(!focus)}
                      >
                        <Icon name="expand" size={15} />
                      </button>
                    </div>
                  </div>
                  <CodeEditor
                    value={code}
                    onChange={setCode}
                    language={language}
                    fontSize={fontSize}
                    theme={theme}
                    onCursor={setCursor}
                  />
                  <div className="editor-status">
                    <span>
                      <i />
                      {lang.name}
                    </span>
                    <div>
                      <span>
                        Ln {cursor.line}, Col {cursor.column}
                      </span>
                      <span>UTF-8</span>
                      <span>Spaces: 4</span>
                    </div>
                  </div>
                </section>
                <aside className="io-panels">
                  <section className="input-panel">
                    <div className="panel-header">
                      <div className="panel-title">
                        <Icon name="terminal" size={16} />
                        Input <span>STDIN</span>
                      </div>
                      <button
                        className="icon-button"
                        aria-label="Import input file"
                        title="Import input file"
                        onClick={() => inputUpload.current.click()}
                      >
                        <Icon name="upload" size={15} />
                      </button>
                    </div>
                    <textarea
                      aria-label="Standard input"
                      value={input}
                      onChange={(e) => update({ input: e.target.value })}
                      placeholder={
                        "Enter input for your program here…\nOne value per line, or space-separated."
                      }
                      spellCheck="false"
                    />
                    <div className="input-hint">
                      <Icon name="file" size={12} /> Passed to your program when
                      it runs
                    </div>
                  </section>
                  <section className="results-panel">
                    <div className="panel-header output-tabs">
                      <div role="tablist" aria-label="Execution results">
                        <button
                          role="tab"
                          aria-selected={panel === "output"}
                          className={panel === "output" ? "active" : ""}
                          onClick={() => setPanel("output")}
                        >
                          <Icon name="terminal" size={15} />
                          Output
                        </button>
                        <button
                          role="tab"
                          aria-selected={panel === "tests"}
                          className={panel === "tests" ? "active" : ""}
                          onClick={() => setPanel("tests")}
                        >
                          <Icon name="check" size={15} />
                          Tests <span>{tests.length}</span>
                        </button>
                      </div>
                      <button
                        className="icon-button"
                        aria-label="Copy output"
                        onClick={() => copy(job?.output || "")}
                      >
                        <Icon name="copy" size={14} />
                      </button>
                    </div>
                    {panel === "output" ? (
                      <div className="output-body" role="tabpanel">
                        {job ? (
                          <>
                            <div className={`result-banner ${job.status}`}>
                              <span
                                className={busy ? "spinner" : "result-dot"}
                              />
                              {statusLabel(job.status)}
                              {job.durationMs !== undefined && (
                                <span>{job.durationMs} ms</span>
                              )}
                            </div>
                            {job.status === "pending" && (
                              <p className="muted">
                                Waiting for a worker
                                {job.queuePosition
                                  ? ` · position ${job.queuePosition}`
                                  : ""}
                                …
                              </p>
                            )}
                            {job.status === "running" && (
                              <p className="muted">
                                Compiling and executing your program…
                              </p>
                            )}
                            {job.output && (
                              <pre className="console-output">{job.output}</pre>
                            )}
                            {job.stderr && job.stderr !== job.output && (
                              <pre className="console-error">{job.stderr}</pre>
                            )}
                            {job.compileOutput && (
                              <pre className="console-error">
                                {job.compileOutput}
                              </pre>
                            )}
                            {job.status === "success" && !job.output && (
                              <p className="muted">
                                Program finished without output.
                              </p>
                            )}
                            {job.status === "success" &&
                              !job.testResults?.length &&
                              job.language === language && (
                                <button
                                  className="text-button capture-test"
                                  onClick={captureTest}
                                  disabled={busy}
                                >
                                  <Icon name="plus" size={13} /> Keep as a test
                                  case
                                </button>
                              )}
                            {job.code &&
                              (job.code !== code ||
                                job.input !== input ||
                                job.language !== language) && (
                                <p className="result-context">
                                  Result from an earlier source or input.
                                </p>
                              )}
                            {job._id && (
                              <div className="job-meta">
                                Job {job._id.slice(-8)}
                                {job.queueWaitMs !== undefined &&
                                  ` · Queue ${job.queueWaitMs} ms`}
                              </div>
                            )}
                          </>
                        ) : (
                          <div className="empty-output">
                            <span className="terminal-art">
                              <Icon name="terminal" size={27} />
                            </span>
                            <h3>Ready when you are.</h3>
                            <p>
                              Run your code to see the result.
                              <br />
                              Your output will appear here.
                            </p>
                            <span className="keyboard-hint">
                              <kbd>⌘</kbd>
                              <kbd>↵</kbd> to run your code
                            </span>
                          </div>
                        )}
                      </div>
                    ) : (
                      <div className="test-panel" role="tabpanel">
                        {job?.testResults?.length > 0 && !resultsCurrent && (
                          <p className="muted test-stale">
                            Code or tests changed. Run again for current
                            results.
                          </p>
                        )}
                        {job?.phase === "compile" && (
                          <pre className="console-error">{job.output}</pre>
                        )}
                        <div className="test-intro">
                          <span>Compare actual and expected output.</span>
                          <button
                            className="text-button"
                            disabled={tests.length >= 10 || busy}
                            onClick={() =>
                              update({
                                tests: [...tests, { input: "", expected: "" }],
                              })
                            }
                          >
                            <Icon name="plus" size={13} /> Add
                          </button>
                        </div>
                        {tests.map((test, index) => (
                          <div className="test-case" key={index}>
                            <div className="test-case-heading">
                              <strong>
                                Case {String(index + 1).padStart(2, "0")}
                              </strong>
                              {resultsCurrent && job?.testResults?.[index] && (
                                <span
                                  className={
                                    job.testResults[index].passed
                                      ? "pass"
                                      : "fail"
                                  }
                                >
                                  {job.testResults[index].passed
                                    ? "Passed"
                                    : "Failed"}
                                </span>
                              )}
                              <button
                                className="icon-button"
                                aria-label={`Remove test ${index + 1}`}
                                disabled={tests.length === 1 || busy}
                                onClick={() =>
                                  update({
                                    tests: tests.filter((_, i) => i !== index),
                                  })
                                }
                              >
                                <Icon name="x" size={13} />
                              </button>
                            </div>
                            <div className="test-fields">
                              <label>
                                Input
                                <textarea
                                  value={test.input}
                                  disabled={busy}
                                  onChange={(e) =>
                                    update({
                                      tests: tests.map((t, i) =>
                                        i === index
                                          ? { ...t, input: e.target.value }
                                          : t,
                                      ),
                                    })
                                  }
                                />
                              </label>
                              <label>
                                Expected output
                                <textarea
                                  value={test.expected}
                                  disabled={busy}
                                  onChange={(e) =>
                                    update({
                                      tests: tests.map((t, i) =>
                                        i === index
                                          ? { ...t, expected: e.target.value }
                                          : t,
                                      ),
                                    })
                                  }
                                />
                              </label>
                            </div>
                            {resultsCurrent && job?.testResults?.[index] && (
                              <OutputDiff result={job.testResults[index]} />
                            )}
                          </div>
                        ))}
                        <button
                          className="button secondary run-tests"
                          disabled={busy || !code.trim()}
                          onClick={() => run(true)}
                        >
                          <Icon name="check" size={15} />
                          Run all tests
                        </button>
                      </div>
                    )}
                  </section>
                </aside>
              </div>
            </>
          ) : (
            <>
              <div className="page-heading">
                <div>
                  <h1>
                    {
                      {
                        snippets: "My snippets",
                        history: "Run history",
                      }[section]
                    }
                  </h1>
                  <p>
                    {
                      {
                        snippets:
                          "Your personal library, stored in this browser.",
                        history:
                          "Your last 30 runs, with source snapshots and results.",
                      }[section]
                    }
                  </p>
                </div>
              </div>
              {section === "snippets" && (
                <div className="collection">
                  {snippets.length ? (
                    snippets.map((item) => (
                      <div className="collection-row" key={item.id}>
                        <Icon name="file" />
                        <div>
                          <strong>{item.name}</strong>
                          <small>
                            {LANGUAGES[item.language].name} ·{" "}
                            {new Date(item.createdAt).toLocaleDateString()}
                          </small>
                        </div>
                        <button
                          className="button secondary"
                          onClick={() => applySnippet(item)}
                        >
                          Open
                        </button>
                        <button
                          className="icon-button"
                          aria-label={`Delete ${item.name}`}
                          onClick={() => {
                            setImported(item);
                            setModal("delete");
                          }}
                        >
                          <Icon name="x" />
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className="collection-empty">
                      <Icon name="book" size={36} />
                      <h2>Your snippet library starts here.</h2>
                      <p>
                        Save code from the playground to return to it later.
                      </p>
                      <button
                        className="button primary"
                        onClick={() => setSection("workspace")}
                      >
                        Open playground
                      </button>
                    </div>
                  )}
                </div>
              )}
              {section === "history" && (
                <div className="collection">
                  {history.length ? (
                    history.map((item, i) => (
                      <div className="collection-row" key={`${item._id}-${i}`}>
                        <span className={`history-indicator ${item.status}`}>
                          <Icon
                            name={item.status === "success" ? "check" : "x"}
                          />
                        </span>
                        <div>
                          <strong>
                            {LANGUAGES[item.language].file}{" "}
                            <span className="history-status">
                              {statusLabel(item.status)}
                            </span>
                          </strong>
                          <small>
                            {new Date(item.submittedAt).toLocaleString()} ·{" "}
                            {item.durationMs ?? "—"} ms
                          </small>
                        </div>
                        <button
                          className="button secondary"
                          onClick={() => {
                            setJob(item);
                            setSection("workspace");
                            setPanel(
                              item.testResults?.length ? "tests" : "output",
                            );
                            if (item.testResults?.length)
                              update({ tests: item.tests });
                          }}
                        >
                          View result
                        </button>
                        <button
                          className="icon-button"
                          aria-label="Restore source snapshot"
                          title="Restore source snapshot"
                          onClick={() => applySnippet(item)}
                        >
                          <Icon name="reset" />
                        </button>
                      </div>
                    ))
                  ) : (
                    <div className="collection-empty">
                      <Icon name="history" size={36} />
                      <h2>A fresh start.</h2>
                      <p>Run a program to begin your execution history.</p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </main>
      </div>
      <input
        ref={backupUpload}
        type="file"
        className="hidden"
        accept=".json"
        aria-label="Import workspace backup"
        onChange={importBackup}
      />
      <input
        ref={codeUpload}
        type="file"
        className="hidden"
        accept=".c,.cpp,.cc,.py,.java,.txt"
        onChange={(e) => importFile(e, false)}
      />
      <input
        ref={inputUpload}
        type="file"
        className="hidden"
        accept=".txt,.in,.csv"
        onChange={(e) => importFile(e, true)}
      />
      {notice && (
        <div className="toast" role="status">
          <Icon name="check" size={17} />
          {notice}
          <button
            className="icon-button"
            aria-label="Dismiss notification"
            onClick={() => setNotice("")}
          >
            <Icon name="x" size={14} />
          </button>
        </div>
      )}
      {modal && (
        <div
          className="modal-backdrop"
          onMouseDown={(e) => {
            if (e.target === e.currentTarget) setModal(null);
          }}
        >
          <div
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            ref={modalRef}
          >
            <button
              className="icon-button modal-close"
              aria-label="Close dialog"
              onClick={() => setModal(null)}
            >
              <Icon name="x" />
            </button>
            <h2 id="modal-title">
              {
                {
                  save: "Keep this idea.",
                  settings: "Settings & backups",
                  system: "How execution works",
                  restore: "Restore this workspace?",
                  shortcuts: "Stay in the flow.",
                  import: "Open this code?",
                  delete: "Delete this snippet?",
                }[modal]
              }
            </h2>
            {modal === "save" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  if (!snippetName.trim()) return;
                  const next = [
                    {
                      id: Date.now().toString(),
                      name: snippetName.trim(),
                      language,
                      code,
                      input,
                      tests,
                      createdAt: new Date().toISOString(),
                    },
                    ...snippets,
                  ].slice(0, 50);
                  if (!saveStorage("compileit.snippets", next)) {
                    setNotice(
                      "Browser storage is full or unavailable. Export a backup before saving more snippets.",
                    );
                    return;
                  }
                  setSnippets(next);
                  setSnippetName("");
                  setModal(null);
                  setNotice("Snippet saved on this device.");
                }}
              >
                <p>Save a named snapshot in your local snippet library.</p>
                <label className="form-label">
                  Snippet name
                  <input
                    autoFocus
                    maxLength={80}
                    value={snippetName}
                    onChange={(e) => setSnippetName(e.target.value)}
                    placeholder="e.g. My binary search"
                    required
                  />
                </label>
                <button className="button primary" type="submit">
                  Save snippet
                </button>
              </form>
            )}
            {modal === "settings" && (
              <>
                <p>Preferences are remembered on this device.</p>
                <button
                  className="text-button settings-info"
                  onClick={() => setModal("system")}
                >
                  How execution and storage work <Icon name="arrow" size={13} />
                </button>
                <div className="backup-controls">
                  <strong>Portable workspace</strong>
                  <p>
                    Take your drafts, input, test cases, and snippets to another
                    browser. Run history stays on this device.
                  </p>
                  <div>
                    <button className="button secondary" onClick={exportBackup}>
                      <Icon name="download" size={15} />
                      Export backup
                    </button>
                    <button
                      className="button secondary"
                      disabled={busy}
                      onClick={() => backupUpload.current.click()}
                    >
                      <Icon name="upload" size={15} />
                      Import backup
                    </button>
                  </div>
                </div>
                <label className="settings-row">
                  Font size
                  <select
                    value={fontSize}
                    onChange={(e) => setFontSize(Number(e.target.value))}
                  >
                    {[12, 14, 16, 18, 20].map((size) => (
                      <option key={size} value={size}>
                        {size} px
                      </option>
                    ))}
                  </select>
                </label>
                <label className="settings-row">
                  Appearance
                  <select
                    value={theme}
                    onChange={(e) => setTheme(e.target.value)}
                  >
                    <option value="dark">Dark</option>
                    <option value="light">Light</option>
                  </select>
                </label>
                <button
                  className="button secondary"
                  onClick={() => {
                    try {
                      localStorage.setItem("default-language", language);
                      setNotice(`${lang.name} set as your default.`);
                    } catch {
                      setNotice("Browser storage is unavailable.");
                    }
                  }}
                >
                  Set {lang.name} as default language
                </button>
              </>
            )}
            {modal === "shortcuts" && (
              <>
                <p>Less clicking, more coding. Use Ctrl on Windows / Linux.</p>
                {[
                  ["Run code", "⌘ / Ctrl + Enter"],
                  ["Run tests", "⌘ / Ctrl + Shift + Enter"],
                  ["Save snippet", "⌘ / Ctrl + S"],
                  ["Find in editor", "⌘ / Ctrl + F"],
                  ["Undo", "⌘ / Ctrl + Z"],
                  ["Close dialog / exit focus", "Esc"],
                ].map(([label, key]) => (
                  <div className="settings-row" key={label}>
                    {label}
                    <kbd>{key}</kbd>
                  </div>
                ))}
              </>
            )}
            {modal === "import" && (
              <>
                <p>
                  This replaces your current{" "}
                  {LANGUAGES[imported?.language]?.name} draft. Save it as a
                  snippet first if you want to keep it.
                </p>
                <pre className="import-preview">
                  {imported?.code?.slice(0, 500)}
                </pre>
                <button
                  className="button primary"
                  onClick={() => {
                    setWorkspace((previous) => ({
                      ...previous,
                      language: imported.language,
                      drafts: {
                        ...previous.drafts,
                        [imported.language]: imported.code,
                      },
                      input: imported.input || "",
                      tests: imported.tests?.length
                        ? imported.tests
                        : previous.tests,
                    }));
                    setModal(null);
                    setSection("workspace");
                    setJob(null);
                  }}
                >
                  Open code
                </button>
              </>
            )}
            {modal === "delete" && (
              <>
                <p>“{imported?.name}” will be removed from this device.</p>
                <button
                  className="button stop-button"
                  onClick={() => {
                    setSnippets((previous) =>
                      previous.filter((item) => item.id !== imported.id),
                    );
                    setModal(null);
                  }}
                >
                  Delete snippet
                </button>
              </>
            )}
            {modal === "restore" && (
              <>
                <p>
                  This backup contains{" "}
                  {Object.keys(imported.workspace.drafts).length} language
                  drafts and {imported.snippets.length} snippets. Restoring
                  replaces your current drafts, input, tests, and snippet
                  library. Export a backup first to keep them.
                </p>
                <div className="backup-actions">
                  <button className="button secondary" onClick={exportBackup}>
                    Back up current workspace
                  </button>
                  <button
                    className="button primary"
                    disabled={busy}
                    onClick={() => {
                      setWorkspace(imported.workspace);
                      setSnippets(imported.snippets);
                      setModal(null);
                      setSection("workspace");
                      setJob(null);
                      setNotice("Workspace restored.");
                    }}
                  >
                    Restore workspace
                  </button>
                </div>
              </>
            )}
            {modal === "system" && (
              <>
                <p>
                  When you press Run, your program joins a waiting line. Up to{" "}
                  {queue?.concurrency || 2} programs run at once; others start
                  as a worker becomes free. This keeps the app responsive when
                  several people run code.
                </p>
                <div className="system-counts">
                  <span>
                    <strong>{queue?.waiting ?? "—"}</strong> waiting
                  </span>
                  <span>
                    <strong>{queue?.active ?? "—"}</strong> running
                  </span>
                </div>
                <dl className="system-details">
                  <dt>Execution</dt>
                  <dd>
                    {health
                      ? health.executionMode === "docker"
                        ? "Isolated Docker container"
                        : "Local process (trusted code only)"
                      : "API offline"}
                  </dd>
                  <dt>Queue</dt>
                  <dd>
                    {queue?.mode === "redis"
                      ? "Redis (persistent)"
                      : queue
                        ? "Memory (resets on restart)"
                        : "Unavailable"}
                  </dd>
                  <dt>Drafts & snippets</dt>
                  <dd>This browser’s local storage</dd>
                  <dt>Submitted jobs</dt>
                  <dd>
                    {queue?.mode === "redis"
                      ? "MongoDB, expires after 24 hours"
                      : "Server memory, clears on restart"}
                  </dd>
                  <dt>Uploaded files</dt>
                  <dd>
                    Read as text into the editor or input; the original file is
                    not stored.
                  </dd>
                </dl>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
export default App;
