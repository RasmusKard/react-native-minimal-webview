// The TypeDoc plugin typedoc.json loads: drops the pills that tell a caller nothing, and shows the platform tags as icons.
import {
  Comment,
  Converter,
  DeclarationReflection,
  PageEvent,
  ReflectionFlag,
  ReflectionKind,
  type Application,
} from 'typedoc';

const PLATFORM_TAGS = ['@android', '@ios'] as const;
// Simple Icons 16.36.0 (CC0); the logos are Google's and Apple's trademarks.
const ICONS: Record<string, string> = {
  Android:
    'M18.4395 5.5586c-.675 1.1664-1.352 2.3318-2.0274 3.498-.0366-.0155-.0742-.0286-.1113-.043-1.8249-.6957-3.484-.8-4.42-.787-1.8551.0185-3.3544.4643-4.2597.8203-.084-.1494-1.7526-3.021-2.0215-3.4864a1.1451 1.1451 0 0 0-.1406-.1914c-.3312-.364-.9054-.4859-1.379-.203-.475.282-.7136.9361-.3886 1.5019 1.9466 3.3696-.0966-.2158 1.9473 3.3593.0172.031-.4946.2642-1.3926 1.0177C2.8987 12.176.452 14.772 0 18.9902h24c-.119-1.1108-.3686-2.099-.7461-3.0683-.7438-1.9118-1.8435-3.2928-2.7402-4.1836a12.1048 12.1048 0 0 0-2.1309-1.6875c.6594-1.122 1.312-2.2559 1.9649-3.3848.2077-.3615.1886-.7956-.0079-1.1191a1.1001 1.1001 0 0 0-.8515-.5332c-.5225-.0536-.9392.3128-1.0488.5449zm-.0391 8.461c.3944.5926.324 1.3306-.1563 1.6503-.4799.3197-1.188.0985-1.582-.4941-.3944-.5927-.324-1.3307.1563-1.6504.4727-.315 1.1812-.1086 1.582.4941zM7.207 13.5273c.4803.3197.5506 1.0577.1563 1.6504-.394.5926-1.1038.8138-1.584.4941-.48-.3197-.5503-1.0577-.1563-1.6504.4008-.6021 1.1087-.8106 1.584-.4941z',
  iOS: 'M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701',
};

export function load(app: Application) {
  // Const: whether an export is a `const` doesn't matter to its users. A const type parameter keeps its flag, since its
  // `const` changes inference.
  app.converter.on(Converter.EVENT_RESOLVE_BEGIN, (context) => {
    for (const variable of context.project.getReflectionsByKind(ReflectionKind.Variable))
      variable.setFlag(ReflectionFlag.Const, false);
  });
  // A property's `@default` renders in its signature row after the type, as a default parameter's does, instead of as
  // a section of its own.
  app.converter.on(Converter.EVENT_RESOLVE_BEGIN, (context) => {
    for (const property of context.project.getReflectionsByKind(ReflectionKind.Property)) {
      const tag = property.comment?.getTag('@default');
      if (!tag || !(property instanceof DeclarationReflection)) continue;
      property.defaultValue = Comment.combineDisplayParts(tag.content).replace(/^`|`$/g, '');
      property.comment?.removeTags('@default');
    }
  });
  // A function's tags sit on its signature, which renders them under the signature; on the function itself they render
  // next to its name, as a variable's and a property's do.
  app.converter.on(Converter.EVENT_RESOLVE_END, (context) => {
    for (const fn of context.project.getReflectionsByKind(ReflectionKind.FunctionOrMethod)) {
      if (!(fn instanceof DeclarationReflection)) continue;
      for (const tag of PLATFORM_TAGS) {
        const moved = fn.signatures?.filter((signature) =>
          signature.comment?.modifierTags.delete(tag)
        ).length;
        if (moved) (fn.comment ??= new Comment()).modifierTags.add(tag);
      }
    }
  });
  // Optional: the signature's `?` says it already. The flag stays, since the `?` comes from it. Returns: the signature
  // shows the type, so the heading stays only above a `@returns` text.
  // shortcut: matches the default theme's markup; check the pills, icons and Returns headings after a TypeDoc upgrade.
  app.renderer.on(PageEvent.END, (page) => {
    page.contents = page.contents
      ?.replace(/<code class="tsd-tag">Optional<\/code> ?/g, '')
      .replace(/<h4 class="tsd-returns-title">(?:(?!<\/h4>).)*<\/h4>(?!\s*<p\b)/gs, '')
      // A member heading puts its flags before the name and a page title after it: the platform icons go after both.
      .replace(
        /(<h3 class="tsd-anchor-link"[^>]*>(?:<code class="tsd-tag">(?!Android<|iOS<)[^<]*<\/code>)*)((?:<code class="tsd-tag">(?:Android|iOS)<\/code>)+)(<span>(?:[^<]|<wbr\/>)*<\/span>)/g,
        '$1$3$2'
      )
      .replace(
        /<code class="tsd-tag">(Android|iOS)<\/code>/g,
        (_, name: string) =>
          `<code class="tsd-tag" title="${name}"><svg role="img" aria-label="${name}" viewBox="0 0 24 24" width="1em" height="1em" fill="currentColor"><path d="${ICONS[name]}"/></svg></code>`
      );
  });
}
