/** 从已知的 HTML 模板中取元素，缺失时立即报错（fail fast） */
export function getElement<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`缺少元素 #${id}`);
  return el as T;
}
