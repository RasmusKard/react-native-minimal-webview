// The TypeDoc plugin .config/typedoc.json loads: drops the Const flag, which tells a caller nothing, titles each page by
// its name, names the iOS tag as Apple does, and titles each package's section of the docs site's nav.
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import {
  Application,
  Converter,
  PageEvent,
  ReflectionFlag,
  Reflection,
  ReflectionKind,
  RendererEvent,
} from 'typedoc';

export function load(app: Application) {
  // Const: whether an export is a `const` doesn't matter to its users. A const type parameter keeps its flag, since its
  // `const` changes inference.
  app.converter.on(Converter.EVENT_RESOLVE_BEGIN, (context) => {
    for (const variable of context.project.getReflectionsByKind(ReflectionKind.Variable))
      variable.setFlag(ReflectionFlag.Const, false);
  });
  // A page's title, and so its nav entry, is its name: typedoc-plugin-markdown's `{name}` adds a type alias's type
  // parameters (`Bridge<Methods, Events>`) but not a function's, which are on its signature. No placeholder leaves them
  // out, and .config/typedoc.json can't hold a template function.
  app.on(Application.EVENT_BOOTSTRAP_END, () =>
    app.options.setValue('pageTitleTemplates', {
      member: ({ name }: { name: string }) => name.replace(/\\<.*/, ''),
    })
  );
  // typedoc-plugin-markdown title-cases a modifier tag's name and ignores the locale, so `@ios` would read "Ios".
  app.renderer.on(PageEvent.END, (page) => {
    page.contents = page.contents?.replaceAll('**`Ios`**', '**`iOS`**');
  });
  // The docs site titles a nav section by its folder's name, so react-native-minimal-webview/ would read "React native
  // minimal webview": a package's folder gets its name as its title.
  app.renderer.on(RendererEvent.END, (event) => {
    for (const { url, model } of event.pages)
      if (model instanceof Reflection && model.kindOf(ReflectionKind.Module))
        writeFileSync(join(event.outputDirectory, dirname(url), '.nav.yml'), `title: ${JSON.stringify(model.name)}\n`);
  });
}
