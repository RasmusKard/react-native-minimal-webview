// The TypeDoc plugin typedoc.json loads: drops the Const pill from variables, which says nothing to a caller. A const
// type parameter keeps its flag, since its `const` changes inference.
import { Converter, ReflectionFlag, ReflectionKind, type Application } from 'typedoc';

export function load(app: Application) {
  app.converter.on(Converter.EVENT_RESOLVE_BEGIN, (context) => {
    for (const variable of context.project.getReflectionsByKind(ReflectionKind.Variable))
      variable.setFlag(ReflectionFlag.Const, false);
  });
}
