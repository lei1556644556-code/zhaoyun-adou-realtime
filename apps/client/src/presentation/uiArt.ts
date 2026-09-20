/** Presentation-only, stable relative paths work under a project deployment prefix. */
export function uiAssetPath(key: string) { return `assets/ui-production/${key}.webp`; }
export function propIcon(id: number) {
  return `<img class="prop-art" src="${uiAssetPath(`prop-${id}`)}" alt="" loading="lazy" draggable="false" />`;
}
export function uiIcon(kind: "sword" | "crossed" | "gate" | "chest" | "flag" | "shield") {
  const paths = {
    sword: '<path d="m6 18 12-12 1-4-4 1L3 15m-1-3 10 10M5 19l-3 3"/>',
    crossed: '<path d="m4 3 4 1 12 12-4 4L4 8Zm16 0-4 1-4 4M8 12l-4 4 4 4m6-3 7 6m-11-6-7 6"/>',
    gate: '<path d="M3 21V7h18v14M1 7l11-5 11 5M8 21V12h8v9M1 21h22"/>',
    chest: '<path d="M3 10V6q9-5 18 0v4M2 10h20v11H2ZM2 14h8m4 0h8m-12-3h4v6h-4Z"/>',
    flag: '<path d="M5 23V2m0 1h15l-3 5 3 5H5M2 23h6"/>',
    shield: '<path d="M12 2 3 6v7q1 6 9 10 8-4 9-10V6ZM8 12l3 3 6-7"/>',
  };
  return `<svg class="ui-symbol" viewBox="0 0 24 26" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true">${paths[kind]}</svg>`;
}
