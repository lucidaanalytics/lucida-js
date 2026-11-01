/** Serialized rrweb node (rrweb-snapshot): only the parts the scrubbers touch. */
export interface SNode {
  type: number;
  id: number;
  tagName?: string;
  attributes?: Record<string, unknown>;
  childNodes?: SNode[];
}

export interface DomEvent {
  type: number;
  data?: {
    source?: number;
    node?: SNode;
    adds?: Array<{ node?: SNode; rule?: unknown }>;
    removes?: unknown[];
    texts?: unknown[];
    attributes?: Array<{ id: number; attributes: Record<string, unknown> }>;
  };
}

export type GetNode = (id: number) => Node | null;
export type AttrVisitor = (attrs: Record<string, unknown>, tag: string, el: Element | null) => void;

const elementOf = (getNode: GetNode, id: number): Element | null => {
  const n = getNode(id);
  return n && n.nodeType === 1 ? (n as Element) : null;
};

/** Calls `fn` with every element's attributes in a full snapshot (type 2) or DOM mutation (type 3, source 0): added subtrees and attribute changes. */
export function visitAttributes(e: DomEvent, getNode: GetNode, fn: AttrVisitor): void {
  const walk = (n: SNode | undefined): void => {
    if (!n) return;
    if (n.type === 2 && n.attributes) fn(n.attributes, (n.tagName ?? "").toLowerCase(), elementOf(getNode, n.id));
    n.childNodes?.forEach(walk);
  };
  if (e.type === 2) walk(e.data?.node);
  if (e.type !== 3 || e.data?.source !== 0) return;
  e.data.adds?.forEach((a) => walk(a.node));
  for (const a of e.data.attributes ?? []) {
    const el = elementOf(getNode, a.id);
    fn(a.attributes, el?.tagName.toLowerCase() ?? "", el);
  }
}
