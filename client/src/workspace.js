import stubs from "./stubs";
export const LANGUAGES = {
  cpp: {
    name: "C++",
    version: "C++17",
    file: "main.cpp",
    badge: "C++",
    color: "#79a9f7",
  },
  py: {
    name: "Python",
    version: "Python 3",
    file: "main.py",
    badge: "Py",
    color: "#f2cd75",
  },
  java: {
    name: "Java",
    version: "Java",
    file: "Main.java",
    badge: "Ja",
    color: "#e99a78",
  },
  c: {
    name: "C",
    version: "C11",
    file: "main.c",
    badge: "C",
    color: "#ac9aef",
  },
};
export function readStorage(key, fallback) {
  try {
    return JSON.parse(localStorage.getItem(key)) ?? fallback;
  } catch {
    return fallback;
  }
}
export function saveStorage(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
    return true;
  } catch {
    return false;
  }
}
export function initialWorkspace() {
  const saved = readStorage("compileit.workspace.v2", {});
  let language = LANGUAGES[saved.language] ? saved.language : "cpp";
  try {
    if (!saved.language && LANGUAGES[localStorage.getItem("default-language")])
      language = localStorage.getItem("default-language");
  } catch {}
  return {
    language,
    drafts: { ...stubs, ...saved.drafts },
    input: typeof saved.input === "string" ? saved.input : "",
    tests: Array.isArray(saved.tests)
      ? saved.tests.slice(0, 10)
      : [{ input: "", expected: "Hello world!" }],
  };
}
export function encodeShare(payload) {
  const bytes = new TextEncoder().encode(JSON.stringify(payload));
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
}
export function decodeShare(hash) {
  if (hash.length > 100000) throw new Error("Shared snippet is too large.");
  const data = JSON.parse(
    new TextDecoder().decode(
      Uint8Array.from(atob(hash), (c) => c.charCodeAt(0)),
    ),
  );
  if (
    !LANGUAGES[data.language] ||
    typeof data.code !== "string" ||
    typeof data.input !== "string"
  )
    throw new Error("Invalid shared snippet.");
  return data;
}

function validateText(value, name) {
  if (typeof value !== "string" || new Blob([value]).size > 65536)
    throw new Error(`${name} must be text under 64 KB.`);
  return value;
}
function validateTests(tests) {
  if (!Array.isArray(tests) || tests.length < 1 || tests.length > 10)
    throw new Error("A workspace needs between 1 and 10 test cases.");
  return tests.map((test) => ({
    input: validateText(test?.input, "Test input"),
    expected: validateText(test?.expected, "Expected output"),
  }));
}
export function createWorkspaceBackup(workspace, snippets) {
  return JSON.stringify(
    {
      format: "compileit-workspace",
      version: 1,
      exportedAt: new Date().toISOString(),
      workspace,
      snippets,
    },
    null,
    2,
  );
}
export function parseWorkspaceBackup(text) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error("This file is not valid JSON.");
  }
  if (
    data?.format !== "compileit-workspace" ||
    data.version !== 1 ||
    !data.workspace ||
    !Object.prototype.hasOwnProperty.call(LANGUAGES, data.workspace.language)
  )
    throw new Error("Choose a supported CompileIt workspace backup.");
  const source = data.workspace;
  const drafts = Object.fromEntries(
    Object.keys(LANGUAGES).map((language) => [
      language,
      validateText(
        source.drafts?.[language],
        `${LANGUAGES[language].name} draft`,
      ),
    ]),
  );
  if (!Array.isArray(data.snippets) || data.snippets.length > 50)
    throw new Error("Backups support up to 50 snippets.");
  const snippets = data.snippets.map((item, index) => {
    if (
      !item ||
      !Object.prototype.hasOwnProperty.call(LANGUAGES, item.language) ||
      typeof item.name !== "string" ||
      !item.name.trim() ||
      item.name.length > 80
    )
      throw new Error("The backup contains an invalid snippet.");
    return {
      id: `restored-${Date.now()}-${index}`,
      name: item.name,
      language: item.language,
      code: validateText(item.code, "Snippet code"),
      input: validateText(item.input, "Snippet input"),
      tests: item.tests?.length
        ? validateTests(item.tests)
        : [{ input: "", expected: "" }],
      createdAt: Number.isNaN(Date.parse(item.createdAt))
        ? new Date().toISOString()
        : item.createdAt,
    };
  });
  return {
    workspace: {
      language: source.language,
      drafts,
      input: validateText(source.input, "Standard input"),
      tests: validateTests(source.tests),
    },
    snippets,
  };
}
