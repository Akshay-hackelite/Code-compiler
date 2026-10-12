import {
  createWorkspaceBackup,
  initialWorkspace,
  parseWorkspaceBackup,
} from "./workspace";
import { compareOutput } from "./components/OutputDiff";
beforeEach(() => localStorage.clear());
test("backups round-trip all drafts, input, tests and snippets", () => {
  const workspace = initialWorkspace();
  workspace.input = "こんにちは";
  workspace.drafts.py = 'print("hello")';
  const snippets = [
    {
      id: "1",
      name: "Example",
      language: "py",
      code: "print(42)",
      input: "",
      tests: [{ input: "", expected: "42" }],
      createdAt: "2026-10-01T00:00:00Z",
    },
  ];
  const restored = parseWorkspaceBackup(
    createWorkspaceBackup(workspace, snippets),
  );
  expect(restored.workspace).toEqual(workspace);
  expect(restored.snippets[0]).toMatchObject({
    name: "Example",
    code: "print(42)",
    tests: snippets[0].tests,
  });
});
test("invalid backup cannot replace valid drafts", () => {
  expect(() => parseWorkspaceBackup("{}")).toThrow("supported CompileIt");
  const data = JSON.parse(createWorkspaceBackup(initialWorkspace(), []));
  data.workspace.drafts.py = 123;
  expect(() => parseWorkspaceBackup(JSON.stringify(data))).toThrow(
    "Python draft",
  );
  data.workspace.drafts.py = "";
  data.workspace.tests = [{}];
  expect(() => parseWorkspaceBackup(JSON.stringify(data))).toThrow(
    "Test input",
  );
});
test("output comparison locates differing columns and handles missing lines and normalized endings", () => {
  expect(
    compareOutput("hello world\n", "hello  world\n").firstMismatch,
  ).toEqual({ line: 1, column: 7 });
  expect(compareOutput("a\nb", "a").firstMismatch).toEqual({
    line: 2,
    column: 1,
  });
  expect(compareOutput("a\r\nb \n", "a\nb").firstMismatch).toBeNull();
});
