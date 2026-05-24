export type ClassValue =
  | string
  | number
  | false
  | null
  | undefined
  | ClassValue[]
  | { [className: string]: unknown };

function collectClass(value: ClassValue, output: string[]) {
  if (!value) return;

  if (typeof value === 'string' || typeof value === 'number') {
    output.push(String(value));
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) collectClass(item, output);
    return;
  }

  if (typeof value === 'object') {
    for (const key of Object.keys(value)) {
      if (value[key]) output.push(key);
    }
  }
}

export function cn(...classes: ClassValue[]) {
  const output: string[] = [];
  for (const classValue of classes) collectClass(classValue, output);
  return output.join(' ');
}
