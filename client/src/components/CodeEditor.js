import React, { useEffect, useRef } from "react";
import { EditorState, Compartment } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { cpp } from "@codemirror/lang-cpp";
import { python } from "@codemirror/lang-python";
import { java } from "@codemirror/lang-java";
import { oneDark } from "@codemirror/theme-one-dark";

export default function CodeEditor({
  value,
  onChange,
  language,
  fontSize,
  theme,
  onCursor,
}) {
  const host = useRef();
  const view = useRef();
  const callback = useRef(onChange);
  const cursor = useRef(onCursor);
  callback.current = onChange;
  cursor.current = onCursor;
  const compartments = useRef({
    language: new Compartment(),
    appearance: new Compartment(),
    size: new Compartment(),
  });
  useEffect(() => {
    const c = compartments.current;
    view.current = new EditorView({
      parent: host.current,
      state: EditorState.create({
        doc: value,
        extensions: [
          basicSetup,
          keymap.of([
            {
              key: "Tab",
              run: (editor) => {
                editor.dispatch(editor.state.replaceSelection("    "));
                return true;
              },
            },
          ]),
          c.language.of(
            language === "py" ? python() : language === "java" ? java() : cpp(),
          ),
          c.appearance.of(theme === "dark" ? oneDark : []),
          c.size.of(EditorView.theme({ "&": { fontSize: `${fontSize}px` } })),
          EditorView.contentAttributes.of({
            "aria-label": "Source code editor",
          }),
          EditorView.updateListener.of((update) => {
            if (update.docChanged)
              callback.current(update.state.doc.toString());
            if (update.selectionSet || update.docChanged) {
              const pos = update.state.selection.main.head;
              const line = update.state.doc.lineAt(pos);
              cursor.current({
                line: line.number,
                column: pos - line.from + 1,
              });
            }
          }),
        ],
      }),
    });
    return () => view.current.destroy();
    // The editor is mounted once; compartments handle subsequent preferences.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (view.current.state.doc.toString() !== value)
      view.current.dispatch({
        changes: { from: 0, to: view.current.state.doc.length, insert: value },
      });
  }, [value]);
  useEffect(() => {
    const c = compartments.current;
    view.current.dispatch({
      effects: [
        c.language.reconfigure(
          language === "py" ? python() : language === "java" ? java() : cpp(),
        ),
        c.appearance.reconfigure(theme === "dark" ? oneDark : []),
        c.size.reconfigure(
          EditorView.theme({ "&": { fontSize: `${fontSize}px` } }),
        ),
      ],
    });
  }, [language, fontSize, theme]);
  return <div className="editor-host" ref={host} />;
}
