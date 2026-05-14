import { Decoration, EditorView, type DecorationSet } from "@codemirror/view";
import { StateField, StateEffect, RangeSetBuilder } from "@codemirror/state";

export const setModifiedLines = StateEffect.define<Set<number>>();

const lineDeco = Decoration.line({ class: "cm-modified-line" });

export const modifiedLinesField = StateField.define<DecorationSet>({
  create: () => Decoration.none,
  update(deco, tr) {
    deco = deco.map(tr.changes);
    for (const e of tr.effects) {
      if (e.is(setModifiedLines)) {
        const builder = new RangeSetBuilder<Decoration>();
        const total = tr.state.doc.lines;
        const sorted = Array.from(e.value).sort((a, b) => a - b);
        for (const n of sorted) {
          if (n < 1 || n > total) continue;
          builder.add(tr.state.doc.line(n).from, tr.state.doc.line(n).from, lineDeco);
        }
        deco = builder.finish();
      }
    }
    return deco;
  },
  provide: (f) => EditorView.decorations.from(f),
});
