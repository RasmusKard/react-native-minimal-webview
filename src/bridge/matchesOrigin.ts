export type OriginForms = {
  any: boolean;
  exact: string[];
  wild: [prefix: string, suffix: string][];
};

function hasAt(text: string, part: string, at: number) {
  for (let k = 0; k < part.length; k++) if (text[at + k] !== part[k]) return false;
  return true;
}

// Runs at document start in frames whose built-ins another same-origin frame may have patched.
export function matchesOrigin(forms: OriginForms, origin: string) {
  if (forms.any) return true;
  for (let i = 0; i < forms.exact.length; i++) if (forms.exact[i] === origin) return true;
  for (let i = 0; i < forms.wild.length; i++) {
    const prefix = forms.wild[i]![0];
    const suffix = forms.wild[i]![1];
    const start = origin.length - suffix.length;
    if (start > prefix.length && hasAt(origin, prefix, 0) && hasAt(origin, suffix, start))
      return true;
  }
  return false;
}
