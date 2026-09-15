/**
 * Tiny DOM helpers. Dependency free on purpose so the UI runs unchanged under
 * jsdom, and every setter is a diff so `update()` can be called every frame.
 */

export type Attrs = Record<string, string | number | boolean | undefined>

export function el<K extends keyof HTMLElementTagNameMap>(
  doc: Document,
  tag: K,
  attrs: Attrs = {},
  children: readonly (Node | string)[] = [],
): HTMLElementTagNameMap[K] {
  const node = doc.createElement(tag)
  for (const key of Object.keys(attrs)) {
    const value = attrs[key]
    if (value === undefined || value === false) continue
    node.setAttribute(key, value === true ? '' : String(value))
  }
  for (const child of children) {
    node.appendChild(typeof child === 'string' ? doc.createTextNode(child) : child)
  }
  return node
}

export function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text
}

export function setAttr(node: HTMLElement, name: string, value: string): void {
  if (node.getAttribute(name) !== value) node.setAttribute(name, value)
}

export function toggleClass(node: HTMLElement, name: string, on: boolean): void {
  if (node.classList.contains(name) !== on) node.classList.toggle(name, on)
}

export function setHidden(node: HTMLElement, hidden: boolean): void {
  if (node.hidden !== hidden) node.hidden = hidden
  toggleClass(node, 'is-hidden', hidden)
}

export function setInputValue(node: HTMLInputElement, value: string): void {
  if (node.value !== value) node.value = value
}

export function fmt(value: number, digits = 1): string {
  return Number.isFinite(value) ? value.toFixed(digits) : (0).toFixed(digits)
}

export function percent(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0
  return Math.max(0, Math.min(100, (value / max) * 100))
}

export function button(
  doc: Document,
  testId: string,
  label: string,
  onClick: () => void,
): HTMLButtonElement {
  const node = el(doc, 'button', { type: 'button', class: 'vc-button', 'data-testid': testId }, [
    label,
  ])
  node.addEventListener('click', onClick)
  return node
}
