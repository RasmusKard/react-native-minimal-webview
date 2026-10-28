// The TypeDoc plugin typedoc.json loads: drops the pills that tell a caller nothing.
import { Converter, PageEvent, ReflectionFlag, ReflectionKind, type Application } from 'typedoc';

export function load(app: Application) {
  // Const: whether an export is a `const` doesn't matter to its users. A const type parameter keeps its flag, since its
  // `const` changes inference.
  app.converter.on(Converter.EVENT_RESOLVE_BEGIN, (context) => {
    for (const variable of context.project.getReflectionsByKind(ReflectionKind.Variable))
      variable.setFlag(ReflectionFlag.Const, false);
  });
  // Optional: the signature's `?` says it already. The flag stays, since the `?` comes from it. Returns: the signature
  // shows the type, so the heading stays only above a `@returns` text.
  // shortcut: matches the default theme's markup; check the pills and Returns headings after a TypeDoc upgrade.
  app.renderer.on(PageEvent.END, (page) => {
    page.contents = page.contents
      ?.replace(/<code class="tsd-tag">Optional<\/code> ?/g, '')
      .replace(/<h4 class="tsd-returns-title">(?:(?!<\/h4>).)*<\/h4>(?!\s*<p\b)/gs, '');
  });
}
